import gremlin from 'gremlin'
const gremlinStatistics = gremlin.process.statics

/**
 * Create a group vertex to put into the graph
 * fields in the document metadata pertain to that document's node, and which pertain to separate nodes.
 * @param {JSON} documentMetadata A generic document's metadata
 * @param {JSON} indexMetadata A generic document's indexes metadata
 * @returns {Object.<string, Object>}
 */
 export const parseGenericMetadataGroup = async (documentMetadata, indexMetadata) => {
    const jq = require('node-jq');
    const GroupMembers = documentMetadata.group_permissions;
    
    for (let i = 0; i < GroupMembers.length; i++) { 
        console.log("Hey here is the value for the Group members that are in this ACL, permission and group " + GroupMembers[i].permissions + ": " + GroupMembers[i].group_id);
    }
    //const { "Indexes": indexes } = indexMetadata;

    //let propertyIndexes = indexes.filter( index => index.Type == 'graph' && index.Indexer == 'property');
    //let nodeIndexes = indexes.filter( index => index.Type == 'graph' && index.Indexer == 'separate-node');

    /*const propertyFields = await Promise.all(propertyIndexes
        .map( async index => {return {
            [index.Name]: await jq.run(index.Field, documentMetadata, { input: 'json', output: 'json' })
        }}));*/
    /*const otherNodes = await Promise.all(nodeIndexes
        .map(async index => {
            let nodeMetadata = await jq.run(index.Field, documentMetadata, { input: 'json', output: 'json' });
            return {
                        [index.Name]: {
                            'nodeRelationship': index.Configuration.relationship,
                            'nodeProperties': index.Configuration.properties
                                .map( fieldKey => {return {
                                    [fieldKey]: nodeMetadata[fieldKey]
                                };})
                        }
                    };
    }))*/

    return {
        'label': "Grid",
        //'propertyFields': propertyFields,
        //'otherNodes': otherNodes
    };
}

export const parsegraphQlQuery = async (documentMetadata, indexMetadata) => {
    const jq = require('node-jq');
    const label = documentMetadata.ConceptType;
    const id = documentMetadata.ConceptId;
    const relationship = documentMetadata.Relationship;
    console.log("This was the Id in the query " + id );
    //const { "Indexes": indexes } = indexMetadata;

    //let propertyIndexes = indexes.filter( index => index.Type == 'graph' && index.Indexer == 'property');
    //let nodeIndexes = indexes.filter( index => index.Type == 'graph' && index.Indexer == 'separate-node');

    /*const propertyFields = await Promise.all(propertyIndexes
        .map( async index => {return {
            [index.Name]: await jq.run(index.Field, documentMetadata, { input: 'json', output: 'json' })
        }}));*/
    /*const otherNodes = await Promise.all(nodeIndexes
        .map(async index => {
            let nodeMetadata = await jq.run(index.Field, documentMetadata, { input: 'json', output: 'json' });
            return {
                        [index.Name]: {
                            'nodeRelationship': index.Configuration.relationship,
                            'nodeProperties': index.Configuration.properties
                                .map( fieldKey => {return {
                                    [fieldKey]: nodeMetadata[fieldKey]
                                };})
                        }
                    };
    }))*/

    return {
        'label': label,
        'id': id,
        'relationship': relationship
    };
}

/**
 * Create a new Generic node with dynamically generated properties
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
        .union(gremlinStatistics.properties(),gremlinStatistics.values())
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

//export const searchWithFitler = async (vertexID, edgeLabel) => {} //Use the filter and Serach.Prefix strategies to return the 
//export const findRelatedEdgeBetweenVertexes = async (vertexID, edgeLabel) => {} //return the edge between two known vertexes
