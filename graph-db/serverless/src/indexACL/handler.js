import 'array-foreach-async'
import gremlin from 'gremlin'

import { getEchoToken } from '../utils/cmr/getEchoToken'
import { initializeGremlinConnection } from '../utils/gremlin/initializeGremlinConnection'
import { parseGenericMetadataGroup, queryConcepts, getVertexesRelatedByEdge } from '../utils/cmr/genericACLQueries'

let gremlinConnection
let token
const acl = new Map();
// ACL is a mapping of actors (subjects) to resources (object) to operations (predicate)
acl.set('Guest', [1]);
acl.set('Ed', [1,2]);
acl.set('Admin', [1,2,3]);

const indexAcl = async (event) => {
    // Prevent creating more tokens than necessary
    if (token === undefined) {
        token = await getEchoToken()
    }

    // Prevent connecting to Gremlin more than necessary
    if (!gremlinConnection) {
        gremlinConnection = initializeGremlinConnection()
        }
        
    const documentMetadata = event;
    const indexMetadata = require('../../../index.json');

    // Parse data into doc type (label) & 2 arrays of objects -- one for the properties in this node,
    // and one for the properties in the other nodes including name of their relationship to this node
    const { 'label': label } = await parseGenericMetadataGroup(documentMetadata, indexMetadata); //just grab the label that is hard coded and check if the acl parsed

    // Insert the node for this generic document
    const queriedProperties = 'Name'
    const returnedVertexes = await queryConcepts(gremlinConnection, label, queriedProperties);
    
    const edgeRelatedVertexes = await getVertexesRelatedByEdge(gremlinConnection, label, 'id','X100000001-PROV1','PublishedBy') //test finding the values

    //const connectedVertexMap = await getVertexesRelatedByEdge(gremlinConnection,"Grid","")
    return {

        returnedVertexes,
        edgeRelatedVertexes
      }
}
export default indexAcl