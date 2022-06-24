import gremlin from 'gremlin'
const gremlinStatistics = gremlin.process.statics
const GraphPredicate = gremlin.process.P;
const SubgraphStrategy = gremlin.process.TraversalStrategy;
const { Graph } = gremlin.structure
import { initializeGremlinConnection } from '../gremlin/initializeGremlinConnection'
const { DriverRemoteConnection } = gremlin.driver

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
 * @param {string} label label for the query to search over
 * @returns {Map} //Returns a Map will the results of the query
 */
 export const queryConcepts = async (gremlinConnection, label) => { //Simple query just returns all of the vertexes with specified concpt
    let node = null
    try {
        // Dynamically add user tokenization to restrict gremlin queries to a specific user group
        //I need to append which things this can actually see here and limit those based on the ACL
        node = await gremlinConnection
        .V()
        .hasLabel(label)
        //.unfold()
        //.union(gremlinStatistics.properties(),gremlinStatistics.values())
        .toList()
        } catch (error) {
            console.log(error);
            return false;
        }

    //const valueMaps = []  = node;
    const { value = {} } = node;
    //const { id: nodeId } = value;
    //console.log("Here are the nodes that you were looking for " + Object.values(value)); //Debugging this function can be added to for quick testing
    return node;
}
/**
 * 
 * @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server in gremlin fashion usually, g
 * @param {string} vertexLabel label for the query to search over
 * @param {string} vertexProperty vertex property for the query to search over
 * @param {string} vertexPropertyValue the value for the vertex property that the query can search over
 * @param {string} edgeLabel the label for the edge off of the outgoing vertex that we can have the query can search over
 * @returns {Map} //Returns a Map will the results of the query
 */
//TODO we should consolidate these arguments into a map to make code maintainance easier
//Returns the vertexes from a specified outgoing edge
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
    //console.log("Here are the nodes that you were looking for " + Object.values(valueMaps[0])); //Debugging
    //console.log(`Node [${nodeId}] for [${label} - ${conceptId}] successfully searched for vertexes in the graph db.`); //Debugging
    return valueMaps;
}

/**
* @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server in gremlin fashion usually, g
* @param {string} vertexLabel label for the query to search over
* @param {string} vertexProperty vertex property for the query to search over
* @param {string} vertexPropertyValue the value for the vertex property that the query can search over
* @returns {Map} //Returns a Map will the results of the query
*/
//Simple query return vertexes that do NOT have X property
export const queryVertexesByExclusiveProperties = async (gremlinConnection,vertexLabel,vertexProperty,vertexPropertyValue) => {
let node = null
//console.log("The property in the eclusive function is " + property); //Debugging property that we are filtering out for
try {
        node = await gremlinConnection
        .V()
        .hasLabel(vertexLabel)
        .not(gremlinStatistics.has(vertexProperty,vertexPropertyValue)) //Look for vertexes that do not have X propery
        .toList()
    } catch (error) {
        //console.log(`Error searching for ${vertexLabel} which does not have the vlaue: [${vertexProperty}]:`); //Debugging
        console.log(error);
        return false;
    }
   const values = []  = node;
   //console.log("Here are the nodes that you were looking for using exclusive properties" + Object.values(value)); //Debugging
    return values;   
}
/**
* @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server in gremlin fashion usually, g
* @param {string} vertexLabel label for the query to search over
* @returns {Integer} //Returns the number of a type of concept
*/
export const getConceptCount = async (gremlinConnection,vertexLabel) => { //Simple queries reuturns the number of a type of concept
let count = 0;
try {
        count = await gremlinConnection
        .V()
        .hasLabel(vertexLabel)
        .count() //Look for vertexes that do not have X property
        .next()
    } catch (error) {
        console.log(error);
        return false;
    }
    //console.log("There are " + count + " for " + vertexLabel + " In the graph database"); //Debugging
   return count;   
}
/**
* @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server in gremlin fashion usually, g
* @param {string} vertexLabel label for the query to search over
* @param {string} vertexProperty vertex property for the query to search over
* @param {string} vertexPropertyValue the value for the vertex property that the query can search over
* @returns {Integer} //Returns the number of vertexes that an outgoing edge "leads" to
*/
//Todo this may need to get abstracted out to include vertexes of the node which are NOT concepts; will need to evaluate if this is a requirement
export const queryCountNumberOfAssociatedVertexes = async (gremlinConnection,vertexLabel,conceptId,edgeLabel) => { //Given the concept Id find out how many vertexes are connected via some relationship
    let count = 0;
    try {
            count = await gremlinConnection
            .V()
            .hasLabel(vertexLabel)
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

//TODO supgraph strategy does not seem to be working with our setup due to gremlin version 3.4.10 not supporting the functionality
// Note this is different than subgraph step which we know does not work with Javascript on gremlin 3.4.10
export const getSubgraph = async (gremlinConnection) => { //Note that subgraphs do NOT actually work on Javascript because it is not a JVM language this is a workaround by passing it as gremlin script
    let resultingGraph = null;
    let vCount = 0;
    let g;
    let sm;
    let driverRC;
    try {
        const graph = new Graph();
        const gremlinUrl = 'ws://localhost:8182/gremlin';
        driverRC = new DriverRemoteConnection(gremlinUrl, {})
        g = graph.traversal().withRemote(driverRC);
        //const ssm = gremlin.traversal().withRemote(new DriverRemoteConnection('ws://localhost:8182/gremlin'));
        //const subGraphStrategy = new SubgraphStrategy({vertices: gremlinStatistics.hasLabel('Grid')});
        //const gWithStrat =  await gremlinConnection.withStrategies(subGraphStrategy).V().toList();
        sm = g.withStrategies(new SubgraphStrategy({vertices: gremlinStatistics.has('groupMembers')}));
        resultingGraph = await sm.V().next();
        //const x = await gremlinConnection.V().count().next();
        //const x = await sub.V().count().next();
        console.log("The sub graph and the gremlin connection");
        //console.log(gWithStrat);
        //console.log(gremlinConnection);
        //console.log("This is supposed to be the subgraph " + resultingGraph.V());
        //VCount = await resultingGraph.V().next();
           //console.log("This is the vertex of the graph" + vCount);
        //vertexCount =  resultingGraph.V().count();
        } catch (error) { 
            console.log(error);
            return false;
        }
    return vCount;
    /*return client.submit("sg = traversal().withEmbedded(subGraph)", { }).then(function (result) { //issue groovy call
        console.log("Result: %s\n", JSON.stringify(result));
    });*/
    //client.close();
    /*client.submit("sg.V()", { }).then(function (result) { //issue groovy call
        console.log("Result: %s\n", JSON.stringify(result));
    });*/
}

/**
* @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server in gremlin fashion usually, g
* @param {string} concept1Map label for the query to search over
* @param {string} concept2Map vertex property for the query to search over
* @returns {node} //Returns the edges and vertexes that are passed between two concepts
*/
// This is returning justthe edges
export const findRelatedEdgeBetweenVertexes = async (gremlinConnection, concept1Map, concept2Map) => {
    let node = null;
    try {
            node = await gremlinConnection
            .V() //Get from the specified vertex to the other vertex and show me the path
            .has('id',concept1Map.id)
            .repeat(gremlinStatistics.outE().as('e').inV())
            .until(gremlinStatistics.has('ShortName',concept2Map.ShortName)) //TODO This needs to be abstracted to consume any property
            .path()
            .select('e')
            .toList()
        } catch (error) {
            console.log(error);
            console.log(concept1Map.id);
            console.log(concept2Map.ShortName);
            return false;
        }
    return node;
}
 //TODO: Some queries we can include
//export const queryGetConceptStats = async (gremlinConnection,label,conceptId,edgeLabel) => {} // Get how many vertexes and edges of some type are there organized .by() some property
//export const searchWithFitler = async (vertexID, edgeLabel) => {} //Use the filter and Serach.Prefix strategies to return nodes that start with X
//Query that leverages mathematical steps such as: count, sum. max. min, will need more application knowledge of how this would be used by clients

