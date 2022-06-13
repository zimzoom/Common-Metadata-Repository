import gremlin from 'gremlin'
const gremlinStatistics = gremlin.process.statics
const GraphPredicate = gremlin.process.P;
/**
 * This is going to be a mock up for queries on the graph database, being initiated by graphQL queries
 * Purpose of reading in queries this way is to try to get ahead of the task of mapping graph queries from 
 * @param {JSON} documentMetadata A generic document's metadata
 * @param {JSON} indexMetadata A generic document's indexes metadata
 * @returns {Object.<string, Object>}
 */

export const parsegraphQlQuery = async (documentMetadata, indexMetadata) => {
    const jq = require('node-jq');
    const label = documentMetadata.ConceptType;
    const id = documentMetadata.ConceptId;
    const relationship = documentMetadata.Relationship;
    return {
        'label': label,
        'id': id,
        'relationship': relationship
    };
}

/**
 * 
 * @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server in gremlin fashion usually, g
 * @param {string} label label for the new node
 * @param {string} properties A list of properties with at least one value that we hope to return
 * @returns {Map} //Returns a Map will the results of the query
 */
 export const queryConcepts = async (gremlinConnection, label, properties) => {
    let node = null
    try {
        // Dynamically add user tokenization to restrict gremlin queries to a specific user group
        //I need to append which things this can actually see here and limit those based on the ACL
        node = await gremlinConnection
        .V()
        .hasLabel(label)
        .values()
        //.unfold()
        //.union(gremlinStatistics.properties(),gremlinStatistics.values())
        //.valueMap() does not work I am very unsure why that it is. I suspect it may have to do with gremlin 3.4.10
        .toList()

        } catch (error) {
            console.log(error);
            return false;
        }

    //const valueMaps = []  = node;
    const { value = {} } = node;
    //const { id: nodeId } = value;
    console.log("Here are the nodes that you were looking for " + Object.values(value)); //Right now this is going to return the list of vertexes that fit the query
    
    //console.log(`Node [${nodeId}] for [${label} - ${conceptId}] successfully searched for vertexes in the graph db.`);
    return node;
}

//Returns the vertexes from the outgoing edge
export const getVertexesRelatedByEdge = async (gremlinConnection,vertexLabel,vertexProperty,vertexPropertyValue, edgeLabel) => {
    let node = null
    try {
        node = await gremlinConnection
        .V()
        .has(vertexLabel,vertexProperty,vertexPropertyValue)
        .out(edgeLabel)
        .union(gremlinStatistics.properties(),gremlinStatistics.values())
        .toList()
        } catch (error) {
            console.log(`Error searching for ${label} nodes in the graph [${conceptId}]:`);
            console.log(error);
            return false;
        }

    const valueMaps = []  = node;
    console.log("Here are the nodes that you were looking for " + Object.values(valueMaps[0])); //Right now this is going to return the list of vertexes that fit the query
    
    //console.log(`Node [${nodeId}] for [${label} - ${conceptId}] successfully searched for vertexes in the graph db.`);
    return valueMaps;

}

export const queryVertexesByExclusiveProperties = async (gremlinConnection,label,property,propertyValue) => {
let node = null
try {
        node = await gremlinConnection
        .V()
        .hasLabel(label)
        .not(gremlinStatistics.has(property,'Some_Property').contains(propertyValue)) //Does NOT contain the a property with the value
        .next()
    } catch (error) {
        console.log(`Error searching for ${label} nodes in the graph [${property}]:`);
        console.log(error);
        return false;
    }
}
//export const findRelatedEdgeBetweenVertexes = async (vertexID, edgeLabel) => {} //return the edge between two known vertexes
//export const searchWithFitler = async (vertexID, edgeLabel) => {} //Use the filter and Serach.Prefix strategies to return nodes that start with X
//export const getConceptCount = async (vertexID, edgeLabel) => {} //Return the number of concepts with that label
// "who are my friends' friends?"
//"where can I fly to from here with a maximum of two stops?" more generally how can I get from x to y with some constraints
// Get the java code int the vertex and figure out any use cases for that
// THere is a regex capability to GraphDB in gremlin which may be helpful build a query from that
// unbounded recusrive traversals 'how is x and y connected' this means we don't know how many connections there are between us