(ns cmr.system-int-test.ingest.granule-translation-test
  (:require
   [clojure.test :refer :all]
   [cmr.common.mime-types :as mime-types]
   [cmr.system-int-test.utils.ingest-util :as ingest]
   [cmr.umm-spec.legacy :as umm-legacy]
   [cmr.umm-spec.test.location-keywords-helper :as location-keywords-helper]
   [cmr.umm-spec.test.umm-g.expected-util :as expected-util]
   [cmr.umm-spec.util :as umm-spec-util]))

(def ^:private valid-input-formats
  [:umm-json
   :iso-smap
   :echo10])

(def ^:private valid-output-formats
  [:umm-json
   :iso-smap
   :iso19115
   :echo10])

(def test-context location-keywords-helper/create-context)

(defn- assert-translate-failure
  [error-regex & args]
  (let [{:keys [status body]} (apply ingest/translate-metadata args)]
    (is (= 400 status))
    (is (re-find error-regex body))))

(defn- assert-invalid-data
  [error-regex & args]
  (let [{:keys [status body]} (apply ingest/translate-metadata args)]
    (is (= 422 status))
    (is (re-find error-regex body))))

(defn- umm->umm-for-comparison
  "Modifies the UMM record for comparison purpose, as not all fields are supported the same in
  between the different granule formats. This function is used marshall ECHO10 and UMM-G parsed
  umm-lib model for comparison. ISO SMAP has even less supported fields and will not use this."
  [gran]
  (-> gran
      (update-in [:spatial-coverage :geometries] set)
      ;; Need to remove the possible duplicate entries in crid-ids and feature-ids
      ;; because Identifiers in UMM-G v1.4 can't contain any duplicates.
      (as-> updated-umm (if (get-in updated-umm [:data-granule :crid-ids])
                          (assoc-in updated-umm [:data-granule :crid-ids] nil)
                          updated-umm))
      (as-> updated-umm (if (get-in updated-umm [:data-granule :feature-ids])
                          (assoc-in updated-umm [:data-granule :feature-ids] nil)
                          updated-umm))
      (as-> updated-umm (if (:project-refs updated-umm)
                          (update updated-umm :project-refs #(set (distinct (conj % umm-spec-util/not-provided))))
                          updated-umm))
      ;; RelatedUrls mapping between ECHO10 and UMM-G is different
      (assoc :related-urls nil)
      (assoc-in [:data-granule :format] nil)
      (assoc-in [:data-granule :files] nil)))

(defn- parsed-metadata-for-comparison
  "Returns the parsed granule metadata for comparison purpose."
  [context metadata output-format]
  (when (not= :iso19115 output-format)
    (let [actual-parsed (umm-legacy/parse-concept
                         context {:concept-type :granule
                                  :format (mime-types/format->mime-type output-format)
                                  :metadata metadata})]
      (umm->umm-for-comparison actual-parsed))))

(deftest translate-granule-metadata
  (doseq [input-format valid-input-formats
          output-format valid-output-formats]
    (testing (format "Translating %s to %s" (name input-format) (name output-format))
      (let [input-str (umm-legacy/generate-metadata
                       test-context expected-util/expected-sample-granule input-format)
            expected (umm->umm-for-comparison expected-util/expected-sample-granule)
            {:keys [status headers body]} (ingest/translate-metadata
                                           :granule input-format input-str output-format)
            content-type (first (mime-types/extract-mime-types (:content-type headers)))
            actual-parsed (parsed-metadata-for-comparison test-context body output-format)]

        (is (= 200 status) body)
        (is (= (mime-types/format->mime-type output-format) content-type))

        ;; now compare the translated metadata when possible
        (cond
          (= :iso19115 output-format)
          ;; only check for the digital print that the metadata is generated by the xslt
          (is (re-find #"Translated from ECHO using ECHOToISO.xsl Version: 1.33" body))

          (or (= :iso-smap input-format) (= :iso-smap output-format))
          ;; ISO SMAP umm-lib parsing and generation support is limited and the conversion
          ;; from/to it is lossy. So we only compare the GranuleUR for now, the rest of the
          ;; UMM fields will be added when ISO SMAP granule support is added.
          (is (= (:granule-ur expected) (:granule-ur actual-parsed)))

          :else
          (is (= expected actual-parsed) "expected & actual failed")))))

  (testing "Failure cases"
    (testing "unsupported input format"
      (assert-translate-failure
       #"The mime types specified in the content-type header \[application/xml\] are not supported"
       :granule :xml "notread" :umm-json))

    (testing "ISO19115 is not supported input format"
      (assert-translate-failure
       #"The mime types specified in the content-type header \[application/iso19115\+xml\] are not supported"
       :granule :iso19115 "notread" :umm-json))

    (testing "not specified input format"
      (assert-translate-failure
       #"The mime types specified in the content-type header \[\] are not supported"
       :granule nil "notread" :umm-json))

    (testing "unsupported output format"
      (assert-translate-failure
       #"The mime types specified in the accept header \[application/xml\] are not supported"
       :granule :echo10 "notread" :xml))

    (testing "not specified output format"
      (assert-translate-failure
       #"The mime types specified in the accept header \[\] are not supported"
       :granule :echo10 "notread" nil))

    (testing "invalid metadata"
      (testing "bad xml"
        (assert-translate-failure
         #"Cannot find the declaration of element 'this'"
         :granule :echo10 "<this> is not good XML</this>" :umm-json))

      (testing "wrong xml format"
        (assert-translate-failure
         #"Cannot find the declaration of element 'Granule'"
         :granule :iso-smap (umm-legacy/generate-metadata
                             test-context expected-util/expected-sample-granule :echo10) :umm-json))

      (testing "bad json"
        (assert-translate-failure #"#: required key \[.*\] not found"
                                  :granule :umm-json "{}" :echo10)))))
