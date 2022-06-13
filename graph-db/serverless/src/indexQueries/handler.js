import 'array-foreach-async'
import gremlin from 'gremlin'

import { getEchoToken } from '../utils/cmr/getEchoToken'
import { initializeGremlinConnection } from '../utils/gremlin/initializeGremlinConnection'
import { queryConcepts, getVertexesRelatedByEdge,parsegraphQlQuery, queryVertexesByExclusiveProperties,getConceptCount,queryVCountNumberOfAssociatedVertexes, getSubgraph} from '../utils/cmr/genericQueries'

let gremlinConnection
let token

const indexQueries = async (event) => {
    // Prevent creating more tokens than necessary
    if (token === undefined) {
        token = await getEchoToken()
    }

    // Prevent connecting to Gremlin more than necessary
    if (!gremlinConnection) {
        gremlinConnection = initializeGremlinConnection()
        }

 
    const documentMetadata = event; //This will be used to pull in the GraphQL query. TODO figure out how these get mapped as gremlin commands
    const indexMetadata = require('../../../index.json');
    const docConceptId = 'X100000001-PROV1'; //Will be deleted useful to have string for testing queries with a known true


    // Parse the GraphQl query into sections that we can utilize by breaking down the .json into gremlin components

    const { 'label': label,
            'relationship': relationship,
            'userGroups': userGroups,
            'id':id 
            } = await parsegraphQlQuery(documentMetadata, indexMetadata);
    
    const returnedVertexes = await queryConcepts(gremlinConnection, "Grid",['1','2']); 
    //const relatedVertex = await getVertexesRelatedByEdge(gremlinConnection,);
    //const exclusiveProperties = await queryVertexesByExclusiveProperties(gremlinConnection,'Grid','id','X100000001-PROV1') //Gremlin 3.4 does not support contains predicate step TODO refactor
    
    const conceptCount = await getConceptCount(gremlinConnection,'Grid') //Returns the count of the specified concept type i.e. how many instancs of these are there isn the gaph database

    const conceptCountFromSpecifiedEdge = await queryVCountNumberOfAssociatedVertexes(gremlinConnection,'ACL','ACL-1234','Controls')

    const subGraph = await getSubgraph();

    return {
        //returnedVertexes,
        //exclusiveProperties,
        //conceptCount,
        conceptCountFromSpecifiedEdge,
        subGraph
    }

}
export default indexQueries