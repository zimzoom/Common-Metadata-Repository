(ns cmr.common-app.services.search.params
  "TODO"
  (:require [cmr.common.util :as u]
            [cmr.common.services.errors :as errors]
            [clojure.string :as str]
            [cmr.common-app.services.search.group-query-conditions :as gc]
            [cmr.common-app.services.search.query-model :as qm]
            [camel-snake-kebab.core :as csk]))


(defn- sanitize-sort-key
  "Sanitizes a single sort key preserving the direction character."
  [sort-key]
  (if-let [[_ dir-char field] (re-find #"([^a-zA-Z])?(.*)" sort-key)]
    (str dir-char (csk/->kebab-case field))
    sort-key))

(defn remove-empty-params
  "Returns the params after removing the ones with value of an empty string
  or string with just whitespaces"
  [params]
  (let [not-empty-string? (fn [value]
                            (not (and (string? value) (= "" (str/trim value)))))]
    (into {} (filter (comp not-empty-string? second) params))))

;; TODO call this from an API.
(defn sanitize-params
  "Manipulates the parameters to make them easier to process"
  [params]
  (-> params
      remove-empty-params
      u/map-keys->kebab-case
      (update-in [:sort-key] #(when % (if (sequential? %)
                                        (map sanitize-sort-key %)
                                        (sanitize-sort-key %))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; Parameter to query conversion
;; TODO consider putting it in it's own namespace


(defmulti always-case-sensitive-fields
  "Returns a set of parameters that will always be case sensitive for the given concept type."
  (fn [concept-type]
    concept-type))

(defmethod always-case-sensitive-fields :default
  [_]
  #{:concept-id})

(defn case-sensitive-field?
  "Return true if the given field is a case-sensitive field"
  [concept-type field options]
  (or (contains? (always-case-sensitive-fields concept-type) field)
      (= "false" (get-in options [field :ignore-case]))))

(defn pattern-field?
  "Returns true if the field is a pattern"
  [concept-type field options]
  (= "true" (get-in options [field :pattern])))

(defn group-operation
  "Returns the group operation (:and or :or) for the given field."
  ([field options]
   (group-operation field options :or))
  ([field options default]
   (cond
     (= "true" (get-in options [field :and])) :and
     (= "true" (get-in options [field :or])) :or
     :else default)))

(defmulti param-mappings
  "Returns the mapping of parameter name to parameter type given a concept type."
  (fn [concept-type]
    concept-type))

(defn- param-name->type
  "Returns the query condition type based on the given concept-type and param-name."
  [concept-type param-name]
  (get (param-mappings concept-type) param-name))

(defmulti parameter->condition
  "Converts a parameter into a condition"
  (fn [concept-type param value options]
    (param-name->type concept-type param)))

(defmethod parameter->condition :default
  [concept-type param value options]
  (errors/internal-error!
    (format "Could not find parameter handler for [%s] with concept-type [%s]"
            param concept-type)))

(defn string-parameter->condition
  [concept-type param value options]
  (if (sequential? value)
    (gc/group-conds (group-operation param options)
                    (map #(string-parameter->condition concept-type param % options) value))
    (let [case-sensitive (case-sensitive-field? concept-type param options)
          pattern (pattern-field? concept-type param options)]
      (qm/string-condition param value case-sensitive pattern))))

(defmethod parameter->condition :string
  [concept-type param value options]
  (string-parameter->condition concept-type param value options))

;; or-conds --> "not (CondA and CondB)" == "(not CondA) or (not CondB)"
(defmethod parameter->condition :exclude
  [concept-type param value options]
  (gc/or-conds
    (map (fn [[exclude-param exclude-val]]
           (qm/map->NegatedCondition
             {:condition (parameter->condition concept-type exclude-param exclude-val options)}))
         value)))

(defmethod parameter->condition :boolean
  [concept-type param value options]
  (cond
    (or (= "true" value) (= "false" value))
    (qm/map->BooleanCondition {:field param
                               :value (= "true" value)})

    (= "unset" (str/lower-case value))
    qm/match-all

    :else
    (errors/internal-error! (format "Boolean condition for %s has invalid value of [%s]" param value))))

(defmethod parameter->condition :num-range
  [concept-type param value options]
  (qm/numeric-range-str->condition param value))

(defn parse-sort-key
  "Parses the sort key param and returns a sequence of maps with fields and order.
   Returns nil if no sort key was specified."
  [sort-key aliases]
  (when sort-key
    (if (sequential? sort-key)
      (mapcat parse-sort-key sort-key aliases)
      (let [[_ dir-char field] (re-find #"([\-+])?(.*)" sort-key)
            direction (cond
                        (= dir-char "-")
                        :desc

                        (= dir-char "+")
                        :asc

                        :else
                        ;; score sorts default to descending sort, everything else ascending
                        (if (= "score" (str/lower-case sort-key))
                          :desc
                          :asc))
            field (keyword field)]
        [{:order direction
          :field (or (get aliases field)
                     field)}]))))

(defn default-parse-standard-params
  ([concept-type params]
   (default-parse-standard-params concept-type params {}))
  ([concept-type params aliases]
   {:concept-type concept-type
    :page-size (Integer. (get params :page-size qm/default-page-size))
    :page-num (Integer. (get params :page-num qm/default-page-num))
    :sort-keys (parse-sort-key (:sort-key params) aliases)
    :result-format (:result-format params)}))

(defmulti parse-standard-params
  "Extracts standard parameters that work on any query api like page-size and page-num and returns
  them in a map as query attributes"
  (fn [concept-type params]
    concept-type))

(defmethod parse-standard-params :default
  [concept-type params]
  (default-parse-standard-params concept-type params))

(defn parse-parameter-query
  "Converts parameters into a query model."
  [concept-type params]
  (let [options (u/map-keys->kebab-case (get params :options {}))
        query-attribs (parse-standard-params concept-type params)
        keywords (when (:keyword params)
                   (str/split (str/lower-case (:keyword params)) #" "))
        params (if keywords (assoc params :keyword (str/join " " keywords)) params)
        params (dissoc params :options :page-size :page-num :boosts :sort-key :result-format
                       ;; TODO these are referring to search app specific things. We need another way to remove these
                       :include-granule-counts :include-has-granules :include-facets
                       :echo-compatible :hierarchical-facets :include-highlights
                       :include-tags :all-revisions)]
    (if (empty? params)
      ;; matches everything
      (qm/query query-attribs)
      ;; Convert params into conditions
      (let [conditions (map (fn [[param value]]
                              (parameter->condition concept-type param value options))
                            params)]
        (qm/query (assoc query-attribs
                         :condition (gc/and-conds conditions)))))))

