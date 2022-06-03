import gremlin from 'gremlin'

const gremlinStatistics = gremlin.process.statics

/**
 * Given a generic document's metadata and index metadata, use the index metadata to select which
 * fields in the document metadata pertain to that document's node, and which pertain to separate nodes.
 * Document node label is always parsed from MetadataSpecification -> Name.
 * @param {JSON} documentMetadata A generic document's metadata
 * @param {JSON} indexMetadata A generic document's indexes metadata
 * @returns {Object.<string, Object>}
 */
export const parseGenericMetadata = async (documentMetadata, indexMetadata) => {
    const jq = require('node-jq');
    const label = documentMetadata.MetadataSpecification.Name;
    const { "Indexes": indexes } = indexMetadata;

    let propertyIndexes = indexes.filter( index => index.Type == 'graph' && index.Indexer == 'property');
    let nodeIndexes = indexes.filter( index => index.Type == 'graph' && index.Indexer == 'separate-node');

    const propertyFields = await Promise.all(propertyIndexes
        .map( async index => {return {
            [index.Name]: await jq.run(index.Field, documentMetadata, { input: 'json', output: 'json' })
        }}));
    const otherNodes = await Promise.all(nodeIndexes
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
    }))

    return {
        'label': label,
        'propertyFields': propertyFields,
        'otherNodes': otherNodes
    };

    // OLD CODE THAT DIDN'T WAIT FOR ALL PROMISES -- BUT WHY. I STILL WANT TO KNOW
    //
    // let propertyFields = new Map();
    // let otherNodes = new Map();
    //
    // let result;
    // indexes.filter( (index) => index.Type == 'graph').forEachAsync( (index) => {
    //     if (index.Indexer == 'property') {
    //         jq.run(index.Field, documentMetadata, { input: 'json', output: 'json' })
    //             .then( (output) =>  {propertyFields.set(index.Name, output);
    //                 console.log("property set");});
    //     } else if (index.Indexer == 'separate-node') {
    //         jq.run(index.Field, documentMetadata, { input: 'json', output: 'json' })
    //             .then( (nodeMetadata) => {
    //                 otherNodes.set(index.Name,
    //                     {
    //                         'nodeRelationship': index.Configuration.relationship,
    //                         'nodeProperties': index.Configuration.properties.map( (fieldKey) =>
    //                                             { return { [fieldKey]: nodeMetadata[fieldKey] }; })
    //                     });
    //                 console.log("node set");});
    //     }})
    //     .then(
    //         result =  {
    //             'label': label,
    //             'propertyFields': propertyFields,
    //             'otherNodes': otherNodes
    //         }
    //     );
    //
    //     return result;

}

/**
 * Create a new Generic node with dynamically generated properties
 * @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server
 * @param {Array<Object>} propertiesMap array of objects whose keys and values will be the properties of the new node
 * @param {string} label label for the new node
 * @param {string} conceptId concept ID for the property 'id' for the new node
 * @returns {number}
 */
 export const insertGenericConceptNode = async (gremlinConnection, propertiesMap, label, conceptId) => {
    let node = null
    try {
        // Build the add vertex command dynamically
        const addVCommand = gremlinConnection.addV(label).property('id', conceptId);
        propertiesMap.forEach( propObj => {
            addVCommand.property(Object.keys(propObj)[0], Object.values(propObj)[0]);
        })

        // Use `fold` and `coalesce` to check existance of vertex, and create one if none exists.
        node = await gremlinConnection
        .V()
        .hasLabel(label)
        .has('id', conceptId)
        .fold()
        .coalesce(
        gremlinStatistics.unfold(),
        addVCommand
        )
        .next()
        } catch (error) {
            console.log(`Error inserting ${label} node [${conceptId}]:`);
            console.log(error);
            return false;
        }

    const { value = {} } = node;
    const { id: nodeId } = value;

    console.log(`Node [${nodeId}] for [${label} - ${conceptId}] successfully inserted into graph db.`);
    return nodeId;
}

/**
 * Create a new Generic node with dynamically generated properties
 * @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server
 * @param {Array<Object>} propertiesMap array of objects whose keys and values will be the properties of the new node
 * @param {string} label label for the new node
 * @param {string} conceptId concept ID for the property 'id' for the new node
 * @returns {number}
 */
 export const insertGenericSubNode = async (gremlinConnection, propertiesMap, label) => {
    let node = null
    let firstPropObj = propertiesMap[0];
    try {
        // Build the add vertex command dynamically
        const addVCommand = gremlinConnection.addV(label);
        propertiesMap.forEach( propObj => {
            addVCommand.property(Object.keys(propObj)[0], Object.values(propObj)[0]);
        })

        // Use `fold` and `coalesce` to check existance of vertex, and create one if none exists.
        node = await gremlinConnection
        .V()
        .hasLabel(label)
        .has(Object.keys(firstPropObj)[0], Object.values(firstPropObj)[0])
        .fold()
        .coalesce(
        gremlinStatistics.unfold(),
        addVCommand
        )
        .next()
        } catch (error) {
            console.log(`Error inserting ${label} node [${Object.values(firstPropObj)[0]}]:`);
            console.log(error);
            return false;
        }

    const { value = {} } = node;
    const { id: nodeId } = value;

    console.log(`Node [${nodeId}] for [${label} - ${Object.values(firstPropObj)[0]}] successfully inserted into graph db.`);
    return nodeId;
}

/**
 * Given 2 existing vertices/nodes, create a new edge connecting them, with dynamically generated label
 * @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server
 * @param {number} nodeId1 ID for node that edge comes 'in' to
 * @param {number} nodeId2 ID for node that edge goes 'out' of
 * @param {string} label label for the new edge
 * @returns {number}
 */
 export const insertGenericEdge = async (gremlinConnection, nodeId1, nodeId2, label) => {
    let newEdge = null;
    try {
        newEdge = await gremlinConnection
        .V(nodeId1).as('c')
        .V(nodeId2)
        .coalesce(
          gremlinStatistics.outE(label).where(gremlinStatistics.inV().as('c')),
          gremlinConnection.addE(label).to('c')
        )
        .next()
    } catch (error) {
        console.log(`Error inserting [${label}] edge connecting [${nodeId1}] and [${nodeId2}]: ${error.message}`);
        throw error;
    }

    const { value = {} } = newEdge;
    const { id: edgeId } = value;

    console.log(`New edge [${label}] inserted from node [${nodeId2}] to node [${nodeId1}]`);
    return edgeId;
}