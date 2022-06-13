import 'array-foreach-async'
import gremlin from 'gremlin'

import { getEchoToken } from '../utils/cmr/getEchoToken'
import { initializeGremlinConnection } from '../utils/gremlin/initializeGremlinConnection'
import { parseGenericMetadata, insertGenericConceptNode, insertGenericSubNode, insertGenericEdge } from '../utils/cmr/genericUtils'

let gremlinConnection
let token

const indexGenerics = async (event) => {
    // Prevent creating more tokens than necessary
    if (token === undefined) {
        token = await getEchoToken()
    }

    // Prevent connecting to Gremlin more than necessary
    if (!gremlinConnection) {
        gremlinConnection = initializeGremlinConnection()
        }

    // Local Prototype Mock Up --
    // Placeholder for when message queue event will be parsed/processed
    //    and search app will give this info.
    // Passing in grid metadata directly in event for local demo,
    //    files used for other info
    const documentMetadata = event;
    const indexMetadata = require('../../../grid_index.json');
    const docConceptId = 'X100000001-PROV1';

    // Parse data into doc type (label) & 2 arrays of objects -- one for the properties in this node,
    // and one for the properties in the other nodes including name of their relationship to this node
    const { 'label': label,
            'propertyFields': propertyFields,
            'otherNodes': otherNodes } = await parseGenericMetadata(documentMetadata, indexMetadata);

    // Insert the node for this generic document
    //const genericDocNodeId = await insertGenericConceptNode(gremlinConnection, propertyFields, label, docConceptId);

    // Iterate through the array for the properties that were indicated as needing to be their own node,
    // for each one, insert 1 node and 1 edge that connects that new node back to the generic document node
    // const otherNodeIds = await Promise.all(otherNodes.map(async otherNodeObj => {
    //     let otherNodeLabel = Object.keys(otherNodeObj)[0];
    //     let otherNodeInfo = Object.values(otherNodeObj)[0];
    //     let otherNodeId = await insertGenericSubNode(gremlinConnection, otherNodeInfo.nodeProperties, otherNodeLabel);
    //     let edgeId = await insertGenericEdge(gremlinConnection, otherNodeId, genericDocNodeId, otherNodeInfo.nodeRelationship);
    //     return {otherNodeId, edgeId};
    // }))

    // returning some extra info for debugging purposes, may need to remove in the future
    return {
        isBase64Encoded: false,
        statusCode: 200,
        propertyFields,
        otherNodes
      }

}

export default indexGenerics