(ns cmr.metadata-db.data.oracle.concepts
  "Provides implementations of the cmr.metadata-db.data.concepts/ConceptStore methods for OracleStore"
  (:require
   [clj-time.coerce :as cr]
   [clojure.java.jdbc :as j]
   [clojure.string :as string]
   [clojure.java.io :as io]
   [cmr.aurora.config :as aurora-config]
   [cmr.aurora.connection :as aurora]
   [cmr.common.concepts :as common-concepts]
   [cmr.common.date-time-parser :as p]
   [cmr.common.log :refer [debug error info trace warn]]
   [cmr.common.util :as util]
   [cmr.metadata-db.data.concepts :as concepts]
   [cmr.metadata-db.data.oracle.concept-tables :as tables]
   [cmr.metadata-db.data.oracle.sql-helper :as sh]
   [cmr.metadata-db.data.util :as db-util :refer [EXPIRED_CONCEPTS_BATCH_SIZE INITIAL_CONCEPT_NUM]]
   [cmr.oracle.connection :as oracle]
   [cmr.oracle.sql-utils :as su :refer [insert values select from where with order-by desc delete as]]
   [cmr.efs.config :as efs-config]
   [cmr.efs.connection :as efs]
   [cmr.dynamo.config :as dynamo-config]
   [cmr.dynamo.connection :as dynamo]
   [cmr.metadata-db.config :as config])
  (:import
   (cmr.oracle.connection OracleStore)))

(defn safe-max
  "Return the maximimum of two numbers, treating nil as the lowest possible number"
  [num1, num2]
  (cond
    (nil? num2)
    num1

    (nil? num1)
    num2

    :else
    (max num1 num2)))

(defn- truncate-highest
  "Return a sequence with the highest top-n values removed from the input sequence. The
  originall order of the sequence may not be preserved."
  [values top-n]
  (drop-last top-n (sort values)))

(defn- add-provider-clause
  "Insert a provider clause at the beginning of a query base clause."
  [provider-id base-clause]
  (if (= (first base-clause) 'clojure.core/and)
    ;; Insert the provider id clause at the beginning.
    `(and (= :provider-id ~provider-id) ~@(rest base-clause))
    `(and (= :provider-id ~provider-id) ~base-clause)))

(defmulti by-provider
  "Converts the sql condition clause into provider aware condition clause, i.e. adding the provider-id
  condition to the condition clause when the given provider is small or the type is acl/access-group;
  otherwise returns the same condition clause. For example:
  `(= :native-id \"blah\") becomes `(and (= :native-id \"blah\") (= :provider-id \"PROV1\"))"
  (fn [concept-type provider base-clause]
    concept-type))

(defmethod by-provider :acl
  [_ {:keys [provider-id]} base-clause]
  (add-provider-clause provider-id base-clause))

(defmethod by-provider :access-group
  [_ {:keys [provider-id]} base-clause]
  (add-provider-clause provider-id base-clause))

(defmethod by-provider :variable
  [_ {:keys [provider-id]} base-clause]
  (add-provider-clause provider-id base-clause))

(defmethod by-provider :service
  [_ {:keys [provider-id]} base-clause]
  (add-provider-clause provider-id base-clause))

(defmethod by-provider :tool
  [_ {:keys [provider-id]} base-clause]
  (add-provider-clause provider-id base-clause))

(defmethod by-provider :subscription
  [_ {:keys [provider-id]} base-clause]
  (add-provider-clause provider-id base-clause))

(doseq [doseq-concept-type (common-concepts/get-generic-concept-types-array)]
  (defmethod by-provider doseq-concept-type
    [_ {:keys [provider-id]} base-clause]
    (add-provider-clause provider-id base-clause)))

(defmethod by-provider :default
  [_ {:keys [provider-id small]} base-clause]
  (if small
    (add-provider-clause provider-id base-clause)
    base-clause))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Multi methods for concept types to implement
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(defmulti db-result->concept-map
  "Translate concept result returned from db into a concept map"
  (fn [concept-type db provider-id result]
    concept-type))

(defmulti concept->insert-args
  "Converts a concept into the insert arguments based on the concept-type and small field of the provider"
  (fn [concept small]
    [(:concept-type concept) small]))

(defmulti after-save
  "This is a handler for concept types to add save specific behavior after the save of a concept has
  been completed. It will be called after a concept has been saved within the transaction."
  (fn [db provider concept]
    (:concept-type concept)))

;; Multimethod defaults

(defmethod db-result->concept-map :default
  [concept-type db provider-id result]
  (when result
    (let [{:keys [native_id
                  concept_id
                  metadata
                  format
                  revision_id
                  revision_date
                  created_at
                  deleted
                  transaction_id]} result]
      (util/remove-nil-keys {:concept-type concept-type
                             :native-id native_id
                             :concept-id concept_id
                             :provider-id provider-id
                             :metadata (when metadata (util/gzip-blob->string metadata))
                             :format (db-util/db-format->mime-type format)
                             :revision-id (int revision_id)
                             :revision-date (oracle/oracle-timestamp->str-time db revision_date)
                             :created-at (when created_at
                                           (oracle/oracle-timestamp->str-time db created_at))
                             :deleted (not= (int deleted) 0)
                             :transaction-id transaction_id}))))

;; this needs to be called within a jdbc transaction and can't be in aurora lib bc cyclic dependencies
(defn db-result->concept-map-aurora
  [concept-type db provider-id result]
  (when result
    (let [{:keys [native_id
                  concept_id
                  metadata
                  format
                  revision_id
                  revision_date
                  created_at
                  deleted
                  transaction_id]} result]
      (util/remove-nil-keys {:concept-type concept-type
                             :native-id native_id
                             :concept-id concept_id
                             :provider-id provider-id
                             :metadata (when metadata (util/gzip-blob->string metadata))
                             :format (db-util/db-format->mime-type format)
                             :revision-id (int revision_id)
                             :revision-date (aurora/db-timestamp->str-time db revision_date)
                             :created-at (when created_at
                                           (aurora/db-timestamp->str-time db created_at))
                             :deleted (not= (int deleted) 0)
                             :transaction-id transaction_id}))))

(defn db-result->concept-map-dynamo
  [concept-type provider-id result]
  (when result
    (let [{:keys [native-id
                  concept-id
                  format
                  revision-id
                  deleted]} result]
      (util/remove-nil-keys {:concept-type concept-type
                             :native-id native-id
                             :concept-id concept-id
                             :provider-id provider-id
                             :format (when format (db-util/db-format->mime-type format))
                             :revision-id (when revision-id (int revision-id))
                             :deleted deleted}))))

(defn concept->common-insert-args
  "Converts a concept into a set of insert arguments that is common for all provider concept types."
  [concept]
  (let [{:keys [concept-type
                native-id
                concept-id
                provider-id
                metadata
                format
                revision-id
                revision-date
                created-at
                deleted]} concept
        fields ["native_id" "concept_id" "metadata" "format" "revision_id" "deleted"]
        values [native-id
                concept-id
                (util/string->gzip-bytes metadata)
                (db-util/mime-type->db-format format)
                revision-id
                deleted]
        fields (cond->> fields
                        revision-date (cons "revision_date")
                        created-at (cons "created_at"))
        values (cond->> values
                        revision-date (cons (cr/to-sql-time (p/parse-datetime revision-date)))
                        created-at (cons (cr/to-sql-time created-at)))]
    [fields values]))

(defmethod after-save :default
  [db provider concept]
  ;; Does nothing
  nil)

(defn- save-concepts-to-tmp-table
  "Utility method to save a bunch of concepts to a temporary table. Must be called from within
  a transaction."
  [conn concept-id-revision-id-tuples]
  (apply j/insert! conn
         "get_concepts_work_area"
         ["concept_id" "revision_id"]
         ;; set :transaction? false since we are already inside a transaction, and
         ;; we want the temp table to persist for the main select
         (concat concept-id-revision-id-tuples [:transaction? false])))

(defn get-latest-concept-id-revision-id-tuples
  "Finds the latest pairs of concept id and revision ids for the given concept ids. If no revisions
  exist for a given concept id it will not be returned."
  [db concept-type provider concept-ids]
  (let [start (System/currentTimeMillis)]
    (j/with-db-transaction
      [conn db]
      ;; use a temporary table to insert our values so we can use a join to
      ;; pull everything in one select
      (apply j/insert! conn
             "get_concepts_work_area"
             ["concept_id"]
             ;; set :transaction? false since we are already inside a transaction, and
             ;; we want the temp table to persist for the main select
             (concat (map vector concept-ids) [:transaction? false]))
      ;; pull back all revisions of each concept-id and then take the latest
      ;; instead of using group-by in SQL
      (let [table (tables/get-table-name provider concept-type)
            stmt (su/build (select [:c.concept-id :c.revision-id]
                             (from (as (keyword table) :c)
                                   (as :get-concepts-work-area :t))
                             (where `(and (= :c.concept-id :t.concept-id)))))
            cid-rid-maps (su/query conn stmt)
            concept-id-to-rev-id-maps (map #(hash-map (:concept_id %) (long (:revision_id %)))
                                           cid-rid-maps)
            latest (apply merge-with safe-max {}
                          concept-id-to-rev-id-maps)
            concept-id-revision-id-tuples (seq latest)
            latest-time (- (System/currentTimeMillis) start)]
        (debug (format "Retrieving latest revision-ids took [%d] ms" latest-time))
        concept-id-revision-id-tuples))))

(defn validate-concept-id-native-id-not-changing
  "Validates that the concept-id native-id pair for a concept being saved is not changing. This
  should be done within a save transaction to avoid race conditions where we might miss it.
  Returns nil if valid and an error response if invalid."
  [db provider concept]
  (let [{:keys [concept-type provider-id concept-id native-id]} concept
        table (tables/get-table-name provider concept-type)
        {:keys [concept_id native_id]} (if (= :subscription concept-type)
                                         (or (su/find-one
                                              db (select [:concept-id :native-id]
                                                         (from table)
                                                         (where `(= :native-id ~native-id))))
                                             (su/find-one db (select [:concept-id :native-id]
                                                                     (from table)
                                                                     (where `(= :concept-id ~concept-id)))))
                                         ;; concepts other than subscription
                                         (or (su/find-one
                                              db (select [:concept-id :native-id]
                                                         (from table)
                                                         (where (by-provider
                                                                 concept-type provider `(= :native-id
                                                                                           ~native-id)))))
                                             (su/find-one db (select [:concept-id :native-id]
                                                                     (from table)
                                                                     (where `(= :concept-id ~concept-id))))))]
    (when (and (and concept_id native_id)
               (or (and (not= concept_id concept-id)
                        ;; In case of generic documents, we need to make sure
                        ;; the concept types are the same.
                        (= (common-concepts/concept-id->type concept_id)
                           (common-concepts/concept-id->type concept-id)))
                   (not= native_id native-id)))
      {:error :concept-id-concept-conflict
       :error-message (format (str "Concept id [%s] and native id [%s] to save do not match "
                                   "existing concepts with concept id [%s] and native id [%s].")
                              concept-id native-id concept_id native_id)
       :existing-concept-id concept_id
       :existing-native-id native_id})))

(defn validate-collection-not-associated-with-another-variable-with-same-name
  "Validates that collection in the concept is not associated with a different
  variable, which has the same name as the variable in the concept.
  Returns nil if valid and an error response if invalid."
  [db concept]
  (let [variable-concept-id (get-in concept [:extra-fields :variable-concept-id])
        associated-concept-id (get-in concept [:extra-fields :associated-concept-id])]
    (when (and variable-concept-id associated-concept-id)
      ;; Get all the other variables sharing the same name; not deleted
      ;; and are associated with the same collection.
      (let [stmt [(format "select va.source_concept_identifier
                           from   (select revision_id, concept_id, deleted, source_concept_identifier, associated_concept_id
                                   from cmr_associations
                                   where association_type = 'VARIABLE-COLLECTION') va,
                                  (select concept_id, max(revision_id) maxrev
                                   from cmr_associations
                                   where association_type = 'VARIABLE-COLLECTION'
                                   group by concept_id) latestva,
                                  cmr_variables v
                           where  va.revision_id = latestva.maxrev
                           and    va.concept_id = latestva.concept_id
                           and    va.deleted = 0
                           and    va.source_concept_identifier = v.concept_id
                           and    va.source_concept_identifier != '%s'
                           and    va.associated_concept_id = '%s'
                           and    v.variable_name in (select variable_name
                                                      from   cmr_variables
                                                      where  concept_id = '%s')"
                          variable-concept-id associated-concept-id variable-concept-id)]
            result (first (su/query db stmt))
            v-concept-id-same-name (:source_concept_identifier result)]
        (when v-concept-id-same-name
          {:error :collection-associated-with-variable-same-name
           :error-message (format (str "Variable [%s] and collection [%s] can not be associated "
                                       "because the collection is already associated with another variable [%s] with same name.")
                                  variable-concept-id associated-concept-id v-concept-id-same-name)})))))

(defn validate-same-provider-variable-association
  "Validates that variable and the collection in the concept being saved are from the same provider.
  Returns nil if valid and an error response if invalid."
  [concept]
  (let [variable-concept-id (get-in concept [:extra-fields :variable-concept-id])
        associated-concept-id (get-in concept [:extra-fields :associated-concept-id])]
    (when (and variable-concept-id associated-concept-id)
      (let [v-provider-id (second (string/split variable-concept-id #"-"))
            c-provider-id (second (string/split associated-concept-id #"-"))]
        (when (not= v-provider-id c-provider-id)
          {:error :variable-association-not-same-provider
           :error-message (format (str "Variable [%s] and collection [%s] can not be associated "
                                       "because they do not belong to the same provider.")
                                  variable-concept-id associated-concept-id)})))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Metadata DB ConceptsStore Implementation
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(defn generate-concept-id
  [db concept]
  (let [{:keys [concept-type provider-id]} concept
        seq-num (:nextval (first (su/query db ["SELECT concept_id_seq.NEXTVAL FROM DUAL"])))]
    (common-concepts/build-concept-id {:concept-type concept-type
                                       :provider-id provider-id
                                       :sequence-number (biginteger seq-num)})))

(defn get-concept-id
  [db concept-type provider native-id]
  (let [table (tables/get-table-name provider concept-type)
        concept-id (:concept_id
                    (su/find-one db (select [:concept-id]
                                            (from table)
                                            (where (by-provider concept-type
                                                    provider `(= :native-id ~native-id))))))]
    ;; In generic document case, they all share the same CMR_GENERIC_DOCUMENTS table,
    ;; which doesn't contain the concept-type that can be used
    ;; in the sql constraint. Therefore, we need to make sure the concept-id
    ;; returned belongs to the same concept-type, so that concepts from different concept types
    ;; won't be updated on top of each other just because they share the same native-id.
    (when (and concept-id
               (= concept-type (common-concepts/concept-id->type concept-id)))
      concept-id)))


(defn get-granule-concept-ids
  [db provider native-id]
  (let [table (tables/get-table-name provider :granule)
        {:keys [provider-id small]} provider
        stmt (if small
               [(format "select /*+ LEADING(b a) USE_NL(b a) INDEX(a SMALL_PROV_GRANULES_CID_REV) */
                         a.concept_id, a.parent_collection_id, a.deleted
                         from %s a,
                         (select concept_id, max(revision_id) revision_id
                         from %s where provider_id = '%s'
                         and native_id = '%s' group by concept_id) b
                         where a.concept_id = b.concept_id
                         and a.revision_id = b.revision_id"
                        table table provider-id native-id)]
               [(format "select /*+ LEADING(b a) USE_NL(b a) INDEX(a %s_GRANULES_CID_REV) */
                         a.concept_id, a.parent_collection_id, a.deleted
                         from %s a,
                         (select /*+INDEX(%s,%s_UCR_I)*/
                         concept_id, max(revision_id) revision_id
                         from %s where native_id = '%s' group by concept_id) b
                         where a.concept_id = b.concept_id
                         and a.revision_id = b.revision_id"
                        provider-id table table table table native-id)])
        result (first (su/query db stmt))
        {:keys [concept_id parent_collection_id deleted]} result
        deleted (when deleted (= 1 (int deleted)))]
    [concept_id parent_collection_id deleted]))

(defn get-concept
  ([db concept-type provider concept-id]
   (let [efs-concept-get (when (or (not= "dynamo-off" (dynamo-config/dynamo-toggle)) (not= "aurora-off" (aurora-config/aurora-toggle)))
                           (util/time-execution
                            (efs/get-concept provider concept-type concept-id)))
         oracle-concept-get (when (not= "dynamo-only" (dynamo-config/dynamo-toggle))
                              (util/time-execution
                               (j/with-db-transaction
                                 [conn db]
                                 (let [table (tables/get-table-name provider concept-type)]
                                   (db-result->concept-map concept-type conn (:provider-id provider)
                                                           (su/find-one conn (select '[*]
                                                                                     (from table)
                                                                                     (where `(= :concept-id ~concept-id))
                                                                                     (order-by (desc :revision-id)))))))))
         dynamo-concept-get (when (not= "dynamo-off" (dynamo-config/dynamo-toggle))
                              (util/time-execution
                               (when-let [get-result (dynamo/get-concept concept-id)]
                                 (db-result->concept-map-dynamo concept-type (:provider-id provider) get-result))))
         aurora-concept-get (when (not= "aurora-off" (aurora-config/aurora-toggle))
                              (util/time-execution
                               (j/with-db-transaction
                                 [conn (config/pg-db-connection)]
                                 (let [table (tables/get-table-name provider concept-type)]
                                   (db-result->concept-map-aurora concept-type conn (:provider-id provider)
                                                                  (aurora/get-concept conn table concept-id))))))]
     (when (or (not= "dynamo-off" (dynamo-config/dynamo-toggle)) (not= "aurora-off" (aurora-config/aurora-toggle)))
       (info "ORT Runtime of EFS get-concept: " (first efs-concept-get) " ms.")
       (info "Output from EFS get-concept: " (second efs-concept-get)))
     (when (not= "dynamo-off" (dynamo-config/dynamo-toggle))
       (info "ORT Runtime of DynamoDB get-concept: " (first dynamo-concept-get) " ms.")
       (info "Output from DynamoDB get-concept: " (second dynamo-concept-get))
       (info "Output of Dynamo + EFS: " (merge (second dynamo-concept-get) (second efs-concept-get))))
     (when (not= "dynamo-only" (dynamo-config/dynamo-toggle))
       (info "ORT Runtime of Oracle get-concept: " (first oracle-concept-get) " ms.")
       (info "Output from Oracle get-concept: " (second oracle-concept-get)))
     (when (not= "aurora-off" (aurora-config/aurora-toggle))
       (info "ORT Runtime of Aurora get-concept: " (first aurora-concept-get) " ms.")
       (info "Output from Aurora get-concept: " (second aurora-concept-get)))
     (if oracle-concept-get
       (second oracle-concept-get)
       (merge (second dynamo-concept-get) (second efs-concept-get)))))
  ([db concept-type provider concept-id revision-id]
   (if revision-id
     (let [table (tables/get-table-name provider concept-type)
           efs-concept-get (when (or (not= "dynamo-off" (dynamo-config/dynamo-toggle)) (not= "aurora-off" (aurora-config/aurora-toggle)))
                             (util/time-execution (efs/get-concept provider concept-type concept-id revision-id)))
           oracle-concept-get (when (not= "dynamo-only" (dynamo-config/dynamo-toggle))
                                (util/time-execution
                                 (j/with-db-transaction
                                   [conn db]
                                   (db-result->concept-map concept-type conn (:provider-id provider)
                                                           (su/find-one conn (select '[*]
                                                                                     (from table)
                                                                                     (where `(and (= :concept-id ~concept-id)
                                                                                                  (= :revision-id ~revision-id)))))))))
           dynamo-concept-get (when (not= "dynamo-off" (dynamo-config/dynamo-toggle))
                                (util/time-execution
                                 (when-let [get-result (dynamo/get-concept concept-id revision-id)]
                                   (db-result->concept-map-dynamo concept-type (:provider-id provider) get-result))))
           aurora-concept-get (when (not= "aurora-off" (aurora-config/aurora-toggle))
                                (util/time-execution
                                 (j/with-db-transaction
                                   [conn (config/pg-db-connection)]
                                   (db-result->concept-map-aurora concept-type conn (:provider-id provider)
                                                                  (aurora/get-concept conn table concept-id revision-id)))))]
       (when (or (not= "dynamo-off" (dynamo-config/dynamo-toggle)) (not= "aurora-off" (aurora-config/aurora-toggle)))
         (info "ORT Runtime of EFS get-concept: " (first efs-concept-get) " ms.")
         (info "Output of EFS get-concept: " (second efs-concept-get)))
       (when (not= "dynamo-off" (dynamo-config/dynamo-toggle))
         (info "ORT Runtime of DynamoDB get-concept: " (first dynamo-concept-get) " ms.")
         (info "Output of DynamoDB get-concept: " (second dynamo-concept-get))
         (info "Output of Dynamo + EFS: " (merge (second dynamo-concept-get) (second efs-concept-get))))
       (when (not= "dynamo-only" (dynamo-config/dynamo-toggle))
         (info "ORT Runtime of Oracle get-concept: " (first oracle-concept-get) " ms.")
         (info "Output of Oracle get-concept: " (second oracle-concept-get)))
       (when (not= "aurora-off" (aurora-config/aurora-toggle))
         (info "ORT Runtime of Aurora get-concept: " (first aurora-concept-get) " ms.")
         (info "Output of Aurora get-concept: " (second aurora-concept-get)))
       (if oracle-concept-get
         (second oracle-concept-get)
         (merge (second dynamo-concept-get) (second efs-concept-get))))
     (get-concept db concept-type provider concept-id))))

(defn get-concepts
  [db concept-type provider concept-id-revision-id-tuples]
  (if (pos? (count concept-id-revision-id-tuples))
    (let [efs-concepts-get (when (or (not= "dynamo-off" (dynamo-config/dynamo-toggle)) (not= "aurora-off" (aurora-config/aurora-toggle)))
                             (util/time-execution
                              (doall (efs/get-concepts provider concept-type concept-id-revision-id-tuples))))
          oracle-concepts-get (when (not= "dynamo-only" (dynamo-config/dynamo-toggle))
                                (util/time-execution
                                 (j/with-db-transaction
                                   [conn db]
                                   ;; use a temporary table to insert our values so we can use a join to
                                   ;; pull everything in one select
                                   (save-concepts-to-tmp-table conn concept-id-revision-id-tuples)

                                   (let [provider-id (:provider-id provider)
                                         table (tables/get-table-name provider concept-type)
                                         stmt (su/build (select [:c.*]
                                                                (from (as (keyword table) :c)
                                                                      (as :get-concepts-work-area :t))
                                                                (where `(and (= :c.concept-id :t.concept-id)
                                                                             (= :c.revision-id :t.revision-id)))))]
                                     (doall (map (partial db-result->concept-map concept-type conn provider-id)
                                                 (su/query conn stmt)))))))
          dynamo-concepts-get (when (not= "dynamo-off" (dynamo-config/dynamo-toggle))
                                (util/time-execution
                                 (doall (map (fn [concept] 
                                               (when concept
                                                 (db-result->concept-map-dynamo concept-type (:provider-id provider) concept)))
                                             (dynamo/get-concepts-provided concept-id-revision-id-tuples)))))
          aurora-concepts-get (when (not= "aurora-off" (aurora-config/aurora-toggle))
                                (util/time-execution
                                 (j/with-db-transaction
                                   [conn (config/pg-db-connection)]
                                    ;; use a temporary table to insert our values so we can use a join to
                                    ;; pull everything in one select
                                   (save-concepts-to-tmp-table conn concept-id-revision-id-tuples)

                                   (let [provider-id (:provider-id provider)
                                         table (tables/get-table-name provider concept-type)
                                         stmt (aurora/gen-get-concepts-sql-with-temp-table table)]
                                     (doall (map (partial db-result->concept-map-aurora concept-type conn provider-id)
                                                 (aurora/get-concepts conn stmt)))))))]
      (when (or (not= "dynamo-off" (dynamo-config/dynamo-toggle)) (not= "aurora-off" (aurora-config/aurora-toggle)))
        (info "ORT Runtime of EFS get-concepts: " (first efs-concepts-get) " ms.")
        (info "Output of EFS get-concepts: " (second efs-concepts-get)))
      (when (not= "dynamo-off" (dynamo-config/dynamo-toggle))
        (info "ORT Runtime of DynamoDB get-concepts: " (first dynamo-concepts-get) " ms.")
        (info "Output of DynamoDB get-concepts: " (second (doall dynamo-concepts-get))))
      (when (not= "dynamo-only" (dynamo-config/dynamo-toggle))
        (info "ORT Runtime of Oracle get-concepts: " (first oracle-concepts-get) " ms.")
        (info "Output of Oracle get-concepts: " (second (doall oracle-concepts-get))))
      (when (not= "aurora-off" (aurora-config/aurora-toggle))
        (info "ORT Runtime of Aurora get-concepts: " (first aurora-concepts-get) " ms.")
        (info "Output of Aurora get-concepts: " (second aurora-concepts-get)))
      (if oracle-concepts-get
        (second oracle-concepts-get)
        (second dynamo-concepts-get)))
    []))

(defn get-latest-concepts
  [db concept-type provider concept-ids]
  (get-concepts
    db concept-type provider
    (get-latest-concept-id-revision-id-tuples db concept-type provider concept-ids)))

(defn get-transactions-for-concept
  [db provider concept-id]
  (j/with-db-transaction
    [conn db]
    (let [concept-type (common-concepts/concept-id->type concept-id)
          table (tables/get-table-name provider concept-type)
          stmt (su/build (select [:c.revision-id :c.transaction-id]
                                 (from (as (keyword table) :c))
                                 (where `(= :c.concept-id ~concept-id))))]
      (map (fn [result] {:revision-id (long (:revision_id result))
                         :transaction-id (long (:transaction_id result))})
           (su/query conn stmt)))))

(defn save-concept
  [db provider concept]
  (try
    (j/with-db-transaction
      [conn db]
      (if-let [error (or (validate-concept-id-native-id-not-changing db provider concept)
                         (when (= :variable-association (:concept-type concept))
                           (or (validate-same-provider-variable-association concept)
                               (validate-collection-not-associated-with-another-variable-with-same-name db concept))))]
       ;; There was a concept id, native id mismatch with earlier concepts
        error
       ;; Concept id native id pair was valid
        (let [{:keys [concept-type]} concept
              table (tables/get-table-name provider concept-type)
              seq-name (str table "_seq")
              [cols values] (concept->insert-args concept (:small provider))
              stmt (format (str "INSERT INTO %s (id, %s, transaction_id) VALUES "
                                "(%s.NEXTVAL,%s,GLOBAL_TRANSACTION_ID_SEQ.NEXTVAL)")
                           table
                           (string/join "," cols)
                           seq-name
                           (string/join "," (repeat (count values) "?")))]
          (trace "Executing" stmt "with values" (pr-str values))
          (when (not= "dynamo-only" (dynamo-config/dynamo-toggle))
            (info "ORT Runtime of Oracle save-concept: " (first (util/time-execution
                                                                 (j/db-do-prepared db stmt values)))) " ms.")
          (when (not= "dynamo-off" (dynamo-config/dynamo-toggle))
            (info "ORT Runtime of DynamoDB save-concept: " (first (util/time-execution
                                                                   (dynamo/save-concept concept)))))
          (when (not= "aurora-off" (aurora-config/aurora-toggle))
            (info "ORT Runtime of Aurora save-concept: " (first (util/time-execution 
                                                                 (j/db-do-prepared (config/pg-db-connection)
                                                                                   (aurora/save-concept table cols seq-name)
                                                                                   values)))
                  (when (and
                         (or (not= "dynamo-off" (dynamo-config/dynamo-toggle)) (not= "aurora-off" (aurora-config/aurora-toggle)))
                         (= false (:deleted concept)))
                    (info "ORT Runtime of EFS save-concept: " (first (util/time-execution (efs/save-concept provider concept-type (zipmap (map keyword cols) values)))) " ms."))))
          (after-save conn provider concept)
          nil)))
    (catch Exception e
      (let [error-message (.getMessage e)
            error-code (if (re-find #"unique constraint.* violated" error-message)
                         :revision-id-conflict
                         :unknown-error)]
        {:error error-code :error-message error-message :throwable e}))))

(defn force-delete
  [this concept-type provider concept-id revision-id]
  (let [table (tables/get-table-name provider concept-type)
        stmt (su/build (delete table
                               (where `(and (= :concept-id ~concept-id)
                                            (= :revision-id ~revision-id)))))
        efs-delete (when (or (not= "dynamo-off" (dynamo-config/dynamo-toggle)) (not= "aurora-off" (aurora-config/aurora-toggle)))
                     (util/time-execution
                      (efs/delete-concept provider concept-type concept-id revision-id)))
        oracle-delete (when (not= "dynamo-only" (dynamo-config/dynamo-toggle))
                        (util/time-execution
                         (j/execute! this stmt)))
        dynamo-delete (when (not= "dynamo-off" (dynamo-config/dynamo-toggle))
                        (util/time-execution
                         (dynamo/delete-concept concept-id revision-id)))
        aurora-delete (when (not= "aurora-off" (aurora-config/aurora-toggle))
                        (util/time-execution
                         (j/execute! (config/pg-db-connection)
                                     (aurora/delete-concept table concept-id revision-id))))]
    (when efs-delete
      (info "ORT Runtime of EFS force-delete: " (first efs-delete) " ms.")
      (info "Output of EFS force-delete: " (second efs-delete)))
    (when oracle-delete
      (info "ORT Runtime of Oracle force-delete: " (first oracle-delete) " ms.")
      (info "Output of Oracle force-delete: " (second oracle-delete)))
    (when dynamo-delete
      (info "ORT Runtime of DynamoDB force-delete: " (first dynamo-delete) " ms.")
      (info "Output of DynamoDB force-delete: " (second dynamo-delete)))
    (when aurora-delete
      (info "ORT Runtime of Aurora force-delete: " (first aurora-delete) " ms.")
      (info "Output of Aurora force-delete: " (second aurora-delete)))
    (if oracle-delete
      (second oracle-delete)
      (second dynamo-delete))))

(defn force-delete-by-params
  [db provider params]
  (sh/force-delete-concept-by-params db provider params))

(defn force-delete-concepts
  [db provider concept-type concept-id-revision-id-tuples]
  (let [table (tables/get-table-name provider concept-type)]
    (j/with-db-transaction
      [conn db]
     ;; use a temporary table to insert our values so we can use them in our delete
      (save-concepts-to-tmp-table conn concept-id-revision-id-tuples)

      (let [stmt [(format "DELETE FROM %s t1 WHERE EXISTS
                           (SELECT 1 FROM get_concepts_work_area tmp WHERE
                           tmp.concept_id = t1.concept_id AND
                           tmp.revision_id = t1.revision_id)"
                          table)]
            efs-delete (when (or (not= "dynamo-off" (dynamo-config/dynamo-toggle)) (not= "aurora-off" (aurora-config/aurora-toggle)))
                         (util/time-execution
                          (efs/delete-concepts provider concept-type concept-id-revision-id-tuples)))
            oracle-delete (when (not= "dynamo-only" (dynamo-config/dynamo-toggle))
                            (util/time-execution
                             (j/execute! conn stmt)))
            dynamo-delete (when (not= "dynamo-off" (dynamo-config/dynamo-toggle))
                            (util/time-execution
                             (dynamo/delete-concepts-provided concept-id-revision-id-tuples)))
            aurora-delete (when (not= "aurora-off" (aurora-config/aurora-toggle))
                            (util/time-execution
                             (save-concepts-to-tmp-table (config/pg-db-connection) concept-id-revision-id-tuples)
                             (j/execute! (config/pg-db-connection) stmt)
                             ;; this is actually the same as oracle but leaving this to grab the print
                             (aurora/delete-concepts provider concept-type concept-id-revision-id-tuples)))]
        (when efs-delete
          (info "ORT Runtime of EFS force-delete-concepts: " (first efs-delete) " ms.")
          (info "Output from EFS force-delete-concepts: " (second efs-delete)))
        (when oracle-delete
          (info "ORT Runtime of Oracle force-delete-concepts: " (first oracle-delete) " ms.")
          (info "Output from Oracle force-delete-concepts: " (second oracle-delete)))
        (when dynamo-delete
          (info "ORT Runtime of DynamoDB force-delete-concepts: " (first dynamo-delete) " ms.")
          (info "Output from DynamoDB force-delete-concepts: " (second dynamo-delete)))
        (when aurora-delete
          (info "ORT Runtime of Aurora force-delete-concepts: " (first aurora-delete) " ms.")
          (info "Output from Aurora force-delete-concepts: " (second aurora-delete)))
        (if oracle-delete
          (second oracle-delete)
          (second dynamo-delete))))))

(defn get-concept-type-counts-by-collection
  [db concept-type provider]
  (let [table (tables/get-table-name provider :granule)
        {:keys [provider-id small]} provider
        stmt (if small
               [(format "select count(1) concept_count, a.parent_collection_id
                        from %s a,
                        (select concept_id, max(revision_id) revision_id
                        from %s where provider_id = '%s' group by concept_id) b
                        where  a.deleted = 0
                        and    a.concept_id = b.concept_id
                        and    a.revision_id = b.revision_id
                        group by a.parent_collection_id"
                        table table provider-id)]
               [(format "select count(1) concept_count, a.parent_collection_id
                        from %s a,
                        (select concept_id, max(revision_id) revision_id
                        from %s group by concept_id) b
                        where  a.deleted = 0
                        and    a.concept_id = b.concept_id
                        and    a.revision_id = b.revision_id
                        group by a.parent_collection_id"
                        table table)])
        result (su/query db stmt)]
    (reduce (fn [count-map {:keys [parent_collection_id concept_count]}]
              (assoc count-map parent_collection_id (long concept_count)))
            {}
            result)))

(defn reset
  [this]
  (try
    (j/db-do-commands this "DROP SEQUENCE concept_id_seq")
    (catch Exception e)) ; don't care if the sequence was not there
  (j/db-do-commands this (format "CREATE SEQUENCE concept_id_seq
                                 START WITH %d
                                 INCREMENT BY 1
                                 CACHE 20" INITIAL_CONCEPT_NUM))
  (j/db-do-commands this "DELETE FROM cmr_tags")
  (j/db-do-commands this "DELETE FROM cmr_associations")
  (j/db-do-commands this "DELETE FROM cmr_groups")
  (j/db-do-commands this "DELETE FROM cmr_acls")
  (j/db-do-commands this "DELETE FROM cmr_humanizers")
  (j/db-do-commands this "DELETE FROM cmr_subscriptions")
  (j/db-do-commands this "DELETE FROM cmr_sub_notifications")
  (j/db-do-commands this "DELETE FROM cmr_services")
  (j/db-do-commands this "DELETE FROM cmr_tools")
  (j/db-do-commands this "DELETE FROM cmr_variables")
  (j/db-do-commands this "DELETE FROM cmr_generic_documents"))

(defn get-expired-concepts
  [this provider concept-type]
  (j/with-db-transaction
   [conn this]
   (let [table (tables/get-table-name provider concept-type)
         {:keys [provider-id small]} provider
         stmt (if small
                [(format "select *
                           from %s outer,
                           ( select a.concept_id, a.revision_id
                           from (select concept_id, max(revision_id) as revision_id
                           from %s
                           where provider_id = '%s'
                           and deleted = 0
                           and   delete_time is not null
                           and   delete_time < systimestamp
                           group by concept_id
                           ) a,
                           (select concept_id, max(revision_id) as revision_id
                           from %s
                           where provider_id = '%s'
                           group by concept_id
                           ) b
                           where a.concept_id = b.concept_id
                           and   a.revision_id = b.revision_id
                           and   rowNum <= %d
                           ) inner
                           where outer.concept_id = inner.concept_id
                           and   outer.revision_id = inner.revision_id"
                         table table provider-id table provider-id EXPIRED_CONCEPTS_BATCH_SIZE)]
                [(format "select *
                           from %s outer,
                           ( select a.concept_id, a.revision_id
                           from (select concept_id, max(revision_id) as revision_id
                           from %s
                           where deleted = 0
                           and   delete_time is not null
                           and   delete_time < systimestamp
                           group by concept_id
                           ) a,
                           (select concept_id, max(revision_id) as revision_id
                           from %s
                           group by concept_id
                           ) b
                           where a.concept_id = b.concept_id
                           and   a.revision_id = b.revision_id
                           and   rowNum <= %d
                           ) inner
                           where outer.concept_id = inner.concept_id
                           and   outer.revision_id = inner.revision_id"
                         table table table EXPIRED_CONCEPTS_BATCH_SIZE)])]
     (doall (map (partial db-result->concept-map concept-type conn (:provider-id provider))
                 (su/query conn stmt))))))

(defn get-tombstoned-concept-revisions
  [this provider concept-type tombstone-cut-off-date limit]
  (j/with-db-transaction
   [conn this]
   (let [table (tables/get-table-name provider concept-type)
         {:keys [provider-id small]} provider
         ;; This will return the concept-id/revision-id pairs for tombstones and revisions
         ;; older than the tombstone - up to 'limit' concepts.
         sql (if small
               (format "select t1.concept_id, t1.revision_id from %s t1 inner join
                         (select concept_id, revision_id from %s
                         where provider_id = '%s' and DELETED = 1 and REVISION_DATE < ?
                         FETCH FIRST %d ROWS ONLY) t2
                         on t1.concept_id = t2.concept_id and t1.REVISION_ID <= t2.revision_id"
                       table table provider-id limit)
               (format "select t1.concept_id, t1.revision_id from %s t1 inner join
                         (select concept_id, revision_id from %s
                         where DELETED = 1 and REVISION_DATE < ?
                         FETCH FIRST %d ROWS ONLY) t2
                         on t1.concept_id = t2.concept_id and t1.REVISION_ID <= t2.revision_id"
                       table table limit))
         stmt [sql (cr/to-sql-time tombstone-cut-off-date)]
         result (su/query conn stmt)]
     ;; create tuples of concept-id/revision-id to remove
     (doall (map (fn [{:keys [concept_id revision_id]}]
                   [concept_id revision_id])
                 result)))))

(defn get-old-concept-revisions
  [this provider concept-type max-revisions limit]
  (j/with-db-transaction
   [conn this]
   (let [table (tables/get-table-name provider concept-type)
         {:keys [provider-id small]} provider
         ;; This will return the concepts that have more than 'max-revisions' revisions.
         ;; Note: the 'where rownum' clause limits the number of concept-ids that are returned,
         ;; not the number of concept-id/revision-id pairs. All revisions are returned for
         ;; each returned concept-id.
         stmt (if small
                [(format "select concept_id, revision_id from %s
                           where concept_id in
                           (select concept_id from %s where provider_id = '%s' group by
                           concept_id having count(*) > %d FETCH FIRST %d ROWS ONLY)"
                         table table provider-id max-revisions limit)]
                [(format "select concept_id, revision_id from %s
                           where concept_id in
                           (select concept_id from %s group by
                           concept_id having count(*) > %d FETCH FIRST %d ROWS ONLY)"
                         table table max-revisions limit)])
         result (su/query conn stmt)
         ;; create a map of concept-ids to sequences of all returned revisions
         concept-id-rev-ids-map (reduce (fn [memo concept-map]
                                          (let [{:keys [concept_id revision_id]} concept-map]
                                            (update-in memo [concept_id] conj revision_id)))
                                        {}
                                        result)]
     ;; generate tuples of concept-id/revision-id to remove
     (reduce-kv (fn [memo concept-id rev-ids]
                  (apply merge memo (map (fn [revision-id]
                                           [concept-id revision-id])
                                         ;; only add tuples for old revisions
                                         (truncate-highest rev-ids max-revisions))))
                []
                concept-id-rev-ids-map))))

(def behaviour
  {:generate-concept-id generate-concept-id
   :get-concept-id get-concept-id
   :get-granule-concept-ids get-granule-concept-ids
   :get-concept get-concept
   :get-concepts get-concepts
   :get-latest-concepts get-latest-concepts
   :get-transactions-for-concept get-transactions-for-concept
   :save-concept save-concept
   :force-delete force-delete
   :force-delete-by-params force-delete-by-params
   :force-delete-concepts force-delete-concepts
   :get-concept-type-counts-by-collection get-concept-type-counts-by-collection
   :reset reset
   :get-expired-concepts get-expired-concepts
   :get-tombstoned-concept-revisions get-tombstoned-concept-revisions
   :get-old-concept-revisions get-old-concept-revisions})

(extend OracleStore
        concepts/ConceptsStore
        behaviour)

(comment

  (def db (get-in user/system [:apps :metadata-db :db]))
  ;; Backdoor tool to read the encoded and zipped metadata column since this can
  ;; not be done in a SQL query tool. All other columns are visible there.
  ;; find a full list of types (param 2) in common-lib/src/cmr/common/concepts.clj
  (let [c (get-concept db :service-association "PROV1" "SA1200000040-CMR")
        raw_meta_edn (:metadata c)
        meta (read-string raw_meta_edn)]
    meta)

  ;; or here is a variable-association example:
  (let [c (get-concept db :variable-association "PROV1" "VA1200000061-CMR")
        _ (println c)
        raw-meta-edn (:metadata c)
        _ (println "raw meta:\n" raw-meta-edn)
        meta (read-string raw-meta-edn)]
    meta))
