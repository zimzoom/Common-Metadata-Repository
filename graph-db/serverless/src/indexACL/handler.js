import 'array-foreach-async'
import gremlin from 'gremlin'

import { getEchoToken } from '../utils/cmr/getEchoToken'
import { initializeGremlinConnection } from '../utils/gremlin/initializeGremlinConnection'
import { parseGenericMetadataGroup, queryConcepts, getVertexesRelatedByEdge, addAclVertex, addAclEdges, addGroupIdGenDoc, queryConceptsByProperty } from '../utils/cmr/genericACLQueries'

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
    const { 'label': label, 'groupMembers':groupMembers, 'legacy-guid':legacyGuid,'aclGroupMembers': groupMemberIdCollection, 'conceptId': conceptId} = await parseGenericMetadataGroup(documentMetadata, indexMetadata); //just grab the label that is hard coded and check if the acl parsed
    
    const addedAclVertex = await addAclVertex(gremlinConnection, label, groupMembers, conceptId); //ACL concept id should probably come from the .json file
    
    const addedGroupsToGenDocsResult = await addGroupIdGenDoc(gremlinConnection, "Grid",["group1", "group2"],"X100000001-PROV1"); //These are chosen since its dummy data
    
    const addAclEdgesResult = await addAclEdges(gremlinConnection, addedAclVertex, groupMemberIdCollection);
    
    const returned_restricted_vertexes = await queryConcepts(gremlinConnection, "Grid",groupMemberIdCollection); //look the grids that I have permission to see

    console.log("This is a key part of the test");

    const returned_restricted_vertexes_By_Property = await queryConceptsByProperty(gremlinConnection, "Grid","id", 'X100000001-PROV1',groupMemberIdCollection); //From the grids I have access to get me the grid
    return {
        returned_restricted_vertexes,
        addedAclVertex,
        addedGroupsToGenDocsResult,
        addAclEdgesResult,
        returned_restricted_vertexes_By_Property    
      }
}
export default indexAcl