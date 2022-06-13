import 'array-foreach-async'
import gremlin from 'gremlin'

import { getEchoToken } from '../utils/cmr/getEchoToken'
import { initializeGremlinConnection } from '../utils/gremlin/initializeGremlinConnection'
import { parseGenericMetadataGroup, queryConcepts, getVertexesRelatedByEdge, addAclVertex, addAclEdges, addGroupIdGenDoc } from '../utils/cmr/genericACLQueries'

let gremlinConnection
let token

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
    const { 'label': label, 'groupMembers':groupMembers, 'legacy-guid':legacyGuid, } = await parseGenericMetadataGroup(documentMetadata, indexMetadata); //just grab the label that is hard coded and check if the acl parsed
    
    
    const addedAclVertex = await addAclVertex(gremlinConnection, label, groupMembers, "ACL-1234");
    const addedGroupsToGenDocsResult = await addGroupIdGenDoc(gremlinConnection, "Grid",["group1", "group2"],"X100000001-PROV1");

    //console.log("Is this the value of the ACL's Id " + addedAclVertex);

    const addAclEdgesResult = await addAclEdges(gremlinConnection, addedAclVertex, 'X100000001-PROV1');

    //const queriedProperties = 'Name'
    
    const returnedVertexes = await queryConcepts(gremlinConnection, "Grid",['1','2']); //look the grids that I have permission to see
    
    //const edgeRelatedVertexes = await getVertexesRelatedByEdge(gremlinConnection, label, 'id','X100000001-PROV1','PublishedBy') //test finding the values

    //const connectedVertexMap = await getVertexesRelatedByEdge(gremlinConnection,"Grid","")
    return {

        returnedVertexes,
        //edgeRelatedVertexes,
        addedAclVertex,
        addedGroupsToGenDocsResult,
        addAclEdgesResult
      }
}
export default indexAcl