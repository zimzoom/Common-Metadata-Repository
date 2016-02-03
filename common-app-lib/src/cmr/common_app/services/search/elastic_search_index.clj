(ns cmr.common-app.services.search.elastic-search-index
  "Implements the search index protocols for searching against Elasticsearch."
  (:require [clojurewerkz.elastisch.rest.document :as esd]
            [clojurewerkz.elastisch.aggregation :as a]
            [clojurewerkz.elastisch.rest.response :as esrsp]
            [clojure.string :as s]
            [cmr.common.log :refer (debug info warn error)]
            [cmr.common.util :as util]
            [cmr.common.lifecycle :as lifecycle]
            [cmr.common.services.errors :as e]
            [cmr.common.concepts :as concepts]
            [cmr.elastic-utils.connect :as es]
            [cmr.common-app.services.search.results :as results]
            [cmr.common-app.services.search.query-model :as qm]
            [cmr.common-app.services.search.query-to-elastic :as q2e]))

(defmulti concept-type->index-info
  "Returns index info based on input concept type. The map should contain a :type-name key along with
   an :index-name key. :index-name can refer to a single index or a comma separated string of multiple
   index names."
  (fn [context concept-type query]
    concept-type))

(defmulti concept-type+result-format->fields
  "Returns the fields that should be selected out of elastic search given a concept type and result
  format"
  (fn [concept-type query]
    [concept-type (:result-format query)]))

(defrecord ElasticSearchIndex
  [
   config

   ;; The connection to elastic
   conn]


  ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
  lifecycle/Lifecycle

  (start
    [this system]
    (assoc this :conn (es/try-connect (:config this))))

  (stop [this system]
        this))

;; TODO this will require the connection to appear in the same place in every service. Either document
;; the requirements or make this dynamic.
(defn context->conn
  [context]
  (get-in context [:system :search-index :conn]))

(defmulti send-query-to-elastic
  "Created to trace only the sending of the query off to elastic search."
  (fn [context query]
    (:page-size query)))

(defmethod send-query-to-elastic :default
  [context query]

  ;; TODO we're referring to highlights here but the query model doesn't contain highlights. We need
  ;; to either put highlights in the query model and document it or find another way to do this.
  (let [{:keys [page-size page-num concept-type result-format aggregations highlights]} query
        elastic-query (q2e/query->elastic query)
        sort-params (q2e/query->sort-params query)
        index-info (concept-type->index-info context concept-type query)
        fields (or (:result-fields query) (concept-type+result-format->fields concept-type query))
        from (* (dec page-num) page-size)
        query-map (util/remove-nil-keys {:query elastic-query
                                         :version true
                                         :sort sort-params
                                         :size page-size
                                         :from from
                                         :fields fields
                                         :aggs aggregations
                                         :highlight highlights})]
    (debug "Executing against indexes [" (:index-name index-info) "] the elastic query:"
           (pr-str elastic-query)
           "with sort" (pr-str sort-params)
           "with aggregations" (pr-str aggregations)
           "and highlights" (pr-str highlights))

    (esd/search (context->conn context)
                (:index-name index-info)
                [(:type-name index-info)]
                query-map)))

(def unlimited-page-size
  "This is the number of items we will request at a time when the page size is set to unlimited"
  10000)

(def max-unlimited-hits
  "This is the maximum number of hits we can fetch if the page size is set to unlimited. We need to
  support fetching fields on every single collection in the CMR. This is set to a number safely above
  what we'll need to support with GCMD (~35K) and ECHO (~5k) collections."
  100000)

;; Implements querying against elasticsearch when the page size is set to :unlimited. It works by
;; calling the default implementation multiple times until all results have been found. It uses
;; the constants defined above to control how many are requested at a time and the maximum number
;; of hits that can be retrieved.
(defmethod send-query-to-elastic :unlimited
  [context query]
  (when (:aggregations query)
    (e/internal-error! "Aggregations are not supported with queries with an unlimited page size."))

  (loop [page-num 1 prev-items [] took-total 0]
    (let [results (send-query-to-elastic
                    context (assoc query :page-num page-num :page-size unlimited-page-size))
          total-hits (get-in results [:hits :total])
          current-items (get-in results [:hits :hits])]

      (when (> total-hits max-unlimited-hits)
        (e/internal-error!
          (format "Query with unlimited page size matched %s items which exceeds maximum of %s. Query: %s"
                  total-hits max-unlimited-hits (pr-str query))))

      (if (>= (+ (count prev-items) (count current-items)) total-hits)
        ;; We've got enough results now. We'll return the query like we got all of them back in one request
        (-> results
            (update-in [:took] + took-total)
            (update-in [:hits :hits] concat prev-items))
        ;; We need to keep searching subsequent pages
        (recur (inc page-num) (concat prev-items current-items) (+ took-total (:took results)))))))


(defn execute-query
  "Executes a query to find concepts. Returns concept id, native id, and revision id."
  [context query]
  (let [start (System/currentTimeMillis)
        e-results (send-query-to-elastic context query)
        elapsed (- (System/currentTimeMillis) start)
        hits (get-in e-results [:hits :total])]
    (debug "Elastic query took" (:took e-results) "ms. Connection elapsed:" elapsed "ms")
    (when (and (= :unlimited (:page-size query)) (> hits (count (get-in e-results [:hits :hits])))
               (e/internal-error! "Failed to retrieve all hits.")))
    e-results))

(defn create-elastic-search-index
  "Creates a new instance of the elastic search index."
  [config]
  (->ElasticSearchIndex config nil))


