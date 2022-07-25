import 'array-foreach-async'
import gremlin from 'gremlin'

import { getEchoToken } from '../utils/cmr/getEchoToken'
import { initializeGremlinConnection } from '../utils/gremlin/initializeGremlinConnection'
import { parseGenericMetadata, insertGenericConceptNode, insertGenericSubNode, insertGenericEdge } from '../utils/cmr/genericUtils'

let gremlinConnection
let token

const bootstrapGenerics = async (event=["var-ops-1000.json", "var_index.json"]) => {
    // Prevent creating more tokens than necessary
    if (token === undefined) {
        token = await getEchoToken()
    }

    // Prevent connecting to Gremlin more than necessary
    if (!gremlinConnection) {
        gremlinConnection = initializeGremlinConnection()
        }

    // Local Prototype Mock Up --
    // Placeholder due to local development. Mocking up:
    // Message queue event will be parsed/processed for concept IDs,
    // which will be used to lookup metadata in search.
    // Expects event json that is an array with 2 strings in this order:
    // [ 'searchResultsFile.json', 'indexMetadataFile.json']
    // Expects searchResults to be exactly that returned from search app.
    // those given files must be in the directory graph-db/local-mockup/
    const searchResults = require(`../../../local-mockup/${event[0]}`)
    const indexMetadata = require(`../../../local-mockup/${event[1]}`)

    await searchResults.forEachAsync(async (searchres) => {
        let { "concept-id": docConceptId } = searchres["meta"];
        let documentMetadata = searchres["umm"];

        // Parse data into doc type (label) & 2 arrays of objects -- one for the properties in this node,
        // and one for the properties in the other nodes including name of their relationship to this node
        let { 'label': label,
            'propertyFields': propertyFields,
            'otherNodes': otherNodes } = await parseGenericMetadata(documentMetadata, indexMetadata);

        // Insert the node for this generic document
        let genericDocNodeId = await insertGenericConceptNode(gremlinConnection, propertyFields, label, docConceptId);

        // Iterate through the array for the fields that were indicated as needing to be their own node,
        // for each one, insert 1 node and 1 edge that connects that new node back to the generic document node
        let otherNodeIds = await Promise.all(otherNodes.map(async otherNodeObj => {
                let otherNodeLabel = Object.keys(otherNodeObj)[0];
                let otherNodeInfo = Object.values(otherNodeObj)[0];
                let otherNodeId = await insertGenericSubNode(gremlinConnection, otherNodeInfo.nodeProperties, otherNodeLabel);
                // Call this function with extra argument only if nodeRelationshipProperties exists
                let edgeId =  await insertGenericEdge.apply(this, (otherNodeInfo.nodeRelationshipProperties ?
                    [gremlinConnection, otherNodeId, genericDocNodeId, otherNodeInfo.nodeRelationship, otherNodeInfo.nodeRelationshipProperties]
                    : [gremlinConnection, otherNodeId, genericDocNodeId, otherNodeInfo.nodeRelationship]));
                //let edgeId = await insertGenericEdge(gremlinConnection, otherNodeId, genericDocNodeId, otherNodeInfo.nodeRelationship);
                return {otherNodeId, edgeId};
            }))

        });

    // returning some extra info for debugging purposes, may need to remove in the future
    return {
        isBase64Encoded: false,
        statusCode: 200
      }

}

export default bootstrapGenerics