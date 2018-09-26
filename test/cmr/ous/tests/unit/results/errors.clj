(ns cmr.opendap.tests.unit.results.errors
  "Note: this namespace is exclusively for unit tests."
  (:require
   [clojure.test :refer :all]
   [cmr.exchange.common.results.errors :as errors]
   [cmr.opendap.results.errors :as ous-errors]))

;; XXX These tests need to be moved into
;;     cmr.exchange.common.tests.unit.results.errors
(deftest any-client-errors?
  (is (not (errors/any-client-errors? {:errors []})))
  (is (errors/any-client-errors? ous-errors/status-map
                                 {:errors ["Oops"
                                           ous-errors/empty-svc-pattern]}))
  (is (errors/any-client-errors? ous-errors/status-map
                                 {:errors [ous-errors/empty-svc-pattern]})))

(deftest any-server-errors?
  (is (not (errors/any-server-errors? {:errors []})))
  (is (not (errors/any-server-errors? {:errors ["Oops"]})))
  (is (errors/any-server-errors? ous-errors/status-map
                                 {:errors ["Oops"
                                           ous-errors/no-matching-service-pattern]}))
  (is (errors/any-server-errors? ous-errors/status-map
                                 {:errors [ous-errors/no-matching-service-pattern]})))

(deftest erred?
  (is (errors/erred? {:error ["an error message"]}))
  (is (errors/erred? {:errors ["an error message"]}))
  (is (not (errors/erred? {:data "stuff"}))))

(deftest any-erred?
  (is (not (errors/any-erred? [{}])))
  (is (not (errors/any-erred? [])))
  (is (not (errors/any-erred? [{:data "stuff"}])))
  (is (errors/any-erred? [{:errors ["an error message"]}]))
  (is (errors/any-erred? [{:errors ["an error message"]}
                          {:data "stuff"}]))
  (is (errors/any-erred? [{:error "an error message"}
                          {:errors ["an error message"]}])))

(deftest collect
  (is (= nil (errors/collect nil)))
  (is (= nil (errors/collect [])))
  (is (= nil (errors/collect {} {})))
  (is (= nil (errors/collect {:data "stuff"})))
  (is (= {:errors ["an error message"]}
         (errors/collect {:errors ["an error message"]})))
  (is (= {:errors ["an error message"]}
         (errors/collect {:errors ["an error message"]}
                         {:data "stuff"})))
  (is (= {:errors ["error message 1" "error message 2"]}
         (errors/collect {:error "error message 1"}
                         {:errors ["error message 2"]}))))
