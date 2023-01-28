/**
 * Returns the order processing SQS queue url from the env variable, or the hard coded offline value
 * @return {string} The order processing queue URL
 */
export const getCollectionIndexingQueueUrl = () => {
    let queueUrl = process.env.COLLECTION_INDEXING_QUEUE_URL

    if (process.env.IS_LOCAL) {
        // If we are running locally offline, this is the queueUrl
        queueUrl = 'http://localhost:9324/queue/graph-db-CollectionIndexingQueue'
    }

    return queueUrl
}