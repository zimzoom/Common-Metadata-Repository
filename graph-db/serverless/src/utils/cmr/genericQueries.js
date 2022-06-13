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
    //Parse the Queries if key is empty string we still grab it; key must be in query
    const jq = require('node-jq');
    const label = documentMetadata.ConceptType;
    const id = documentMetadata.ConceptId;
    const relationship = documentMetadata.Relationship;
    const userGroups = documentMetadata.userGroups; //string array containing groups
    return {
        'label': label,
        'id': id,
        'relationship': relationship,
        'userGroups': userGroups,
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
console.log("The property in the eclusive function is " + property);
try {
        node = await gremlinConnection
        .V()
        .hasLabel(label)
        .not(gremlinStatistics.has(property,propertyValue)) //Look for vertexes that do not have X prope
        .toList()
    } catch (error) {
        console.log(`Error searching for ${label} which does not have the vlaue: [${property}]:`);
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

export const getConceptCount = async (gremlinConnection,label) => {
let count = 0;
try {
        count = await gremlinConnection
        .V()
        .hasLabel(label)
        .count() //Look for vertexes that do not have X prope
        .next()
    } catch (error) {
        //console.log(`Error searching for ${label} which does not have the vlaue: [${property}]:`);
        console.log(error);
        return false;
    }
    console.log("There are " + count + " for " + label + " In the graph database");
   //console.log(`Node [${nodeId}] for [${label} - ${conceptId}] successfully searched for vertexes in the graph db.`);
   return count;   
}

export const queryVCountNumberOfAssociatedVertexes = async (gremlinConnection,label,conceptId,edgeLabel) => { //Given the concept Id find out how many vertexes are connected via some relationship
    let count = 0;
    try {
            count = await gremlinConnection
            .V()
            .hasLabel(label)
            .has('id',conceptId)
            .out(edgeLabel) //Traverse out of an edge with this label to get the count gets list of vertexes
            .count()
            .next()
        } catch (error) {
            console.log(error);
            return false;
        }
    return count;
}

export const getSubgraph = async () => { //Note that subgraphs do NOT actually work on Javascript because it is not a JVM language this is a workaround by passing it as gremlin script
    const client = new gremlin.driver.Client(
    "ws://localhost:8182/gremlin",
    {
        traversalsource : "g"
    }); //Connect to the server to send out a Gremlin Script to it
    return client.submit("sg = g.E().subgraph('sg').cap('sg').next().traversal()", { }).then(function (result) { //issue groovy call
        console.log("Result: %s\n", JSON.stringify(result));
    });
    /*return client.submit("sg = traversal().withEmbedded(subGraph)", { }).then(function (result) { //issue groovy call
        console.log("Result: %s\n", JSON.stringify(result));
    });*/
    //client.close();
    /*client.submit("sg.V()", { }).then(function (result) { //issue groovy call
        console.log("Result: %s\n", JSON.stringify(result));
    });*/

}

 //TODO: Some queries we can include
//export const queryGetConceptStats = async (gremlinConnection,label,conceptId,edgeLabel) => {} // Get how many vertexes and edges of some type are there organized .by() some property
//export const findRelatedEdgeBetweenVertexes = async (vertexID, edgeLabel) => {} //return the edge between two known vertexes
//export const searchWithFitler = async (vertexID, edgeLabel) => {} //Use the filter and Serach.Prefix strategies to return nodes that start with X
//export const getConceptCount = async (vertexID, edgeLabel) => {} //Return the number of concepts with that label
//export const returnSubgraph = async (vertexID, edgeLabel) => {} //Return a subgraph of the main graph that can then have work executed on it