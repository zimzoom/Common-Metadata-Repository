(ns cmr.bootstrap.services.health-service
  "Contains fuctions to provider health status of the bootstrap app."
  (:require [cmr.system-trace.core :refer [deftracefn]]
            [cmr.transmit.metadata-db :as mdb]
            [cmr.metadata-db.services.health-service :as hs]
            [cmr.indexer.services.index-service :as indexer]))

(deftracefn health
  "Returns the health state of the app."
  [context]
  (let [metadata-db-health (mdb/get-metadata-db-health context)
        indexer-context (assoc context :system (get-in context [:system :indexer]))
        indexer-health (indexer/health indexer-context)
        internal-meta-db-context (assoc context :system (get-in context [:system :metadata-db]))
        internal-meta-db-health (hs/health internal-meta-db-context)
        ok? (every? :ok? [metadata-db-health internal-meta-db-health indexer-health])]
    {:ok? ok?
     :dependencies {:metadata-db metadata-db-health
                    :internal-meta-db internal-meta-db-health
                    :indexer indexer-health}}))