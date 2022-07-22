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
            if (nodeMetadata == null) {
                return nodeMetadata;
            }
            // If this metadata field is an array of objects (producing multiple nodes), return an array of objects
            else if (Array.isArray(nodeMetadata)) {
                return nodeMetadata.map( (metadataObj, i) => {
                    return parseOtherNode(index.Name, index.Configuration, nodeMetadata[i]);
                    // return {
                    //             [index.Name]: {
                    //                 'nodeRelationship': index.Configuration.relationship,
                    //                 'nodeProperties': index.Configuration.properties.map( fieldKey => {return {[fieldKey]: nodeMetadata[i][fieldKey]}})
                    //                     }
                    //         }
                })
            // If this metadata field is one object (producing one node), return one object
            } else {
                return parseOtherNode(index.Name, index.Configuration, nodeMetadata);
                // return {
                //             [index.Name]: {
                //                 'nodeRelationship': index.Configuration.relationship,
                //                 'nodeProperties': index.Configuration.properties
                //                     .map( fieldKey => {return {
                //                         [fieldKey]: nodeMetadata[fieldKey]
                //                     };})
                //             }
                //         };
            }
        }))

    // Removes nulls, then flattens out the list of nodes in case it includes arrays
    // [ [obj1, obj2], null, obj3 ] ==> [ ob1, obj2, obj3 ]
    const cleanOtherNodes = otherNodes.filter(Boolean).flat();
    // Remove nulls from property fields as well
    const cleanPropertyFields = propertyFields.filter(Boolean);

    return {
        'label': label,
        'propertyFields': cleanPropertyFields,
        'otherNodes': cleanOtherNodes
    };
}

/**
 * Helper function for parseGenericMetadata, specifically part of 'separate-node' Indexer.
 * Given Name and Configuration from index metadata, return an object representing info needed to
 * create a separate node. nodeRelationship & nodeRelationshipProperties will become the label and properties
 * for the edge connecting this node to the generic document's node.
 * @param {String} name The Name field from index item, will become node label
 * @param {Object} configuration The Configuration field from index item. {"properties": [arr], "relationship": 'string', (optionally)"relationshipProperties": [arr]}
 * @param {Object} metadataObj The object returned by jq selection from document metadata representing the entity to become a separate node
 * @returns {Object.<string, Object>}
 */
const parseOtherNode = (name, configuration, metadataObj) => {
    return {
                [name]: {
                        'nodeRelationship': configuration.relationship,
                        'nodeProperties': configuration.properties
                                            .map( fieldKey => {
                                                return {
                                                        [fieldKey]: metadataObj[fieldKey]
                                                        };
                                            } ),
                        // Add this object attribute only if relationshipProperties exists
                        ...(configuration.relationshipProperties &&
                            {
                                'nodeRelationshipProperties': configuration.relationshipProperties
                                                                .map( fieldKey => {
                                                                    return {
                                                                            [fieldKey]: metadataObj[fieldKey]
                                                                            };
                                                                } )
                            })
                        }
            };
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
 export const insertGenericEdge = async (gremlinConnection, nodeId1, nodeId2, label, propertiesMap=null) => {
    let newEdge = null;
    try {
        // Build the add edge command dynamically
        const addECommand = gremlinConnection.addE(label);
        if (propertiesMap) {
            propertiesMap.forEach( propObj => {
                addECommand.property(Object.keys(propObj)[0], Object.values(propObj)[0]);
            })
        }

        newEdge = await gremlinConnection
        .V(nodeId1).as('c')
        .V(nodeId2)
        .coalesce(
          gremlinStatistics.outE(label).where(gremlinStatistics.inV().as('c')),
          addECommand.to('c')
        )
        .next()
    } catch (error) {
        console.log(`Error inserting [${label}] edge connecting [${nodeId1}] and [${nodeId2}]: ${error.message}`);
        throw error;
    }

    const { value = {} } = newEdge;
    const { id: edgeId } = value;

    console.log(`New edge [${label}][${edgeId}] inserted from node [${nodeId2}] to node [${nodeId1}]`);
    return edgeId;
}