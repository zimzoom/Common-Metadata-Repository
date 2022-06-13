import gremlin from 'gremlin'
const gremlinStatistics = gremlin.process.statics
const GraphPredicate = gremlin.process.P;
/**
 * Parse the Generic ACL .json and return properties which will be used to construct the ACL in subsequent functions
 * @param {JSON} documentMetadata A generic document's metadata
 * @param {JSON} indexMetadata A generic document's indexes metadata
 * @returns {Object.<string, Object>}
 */
 export const parseGenericMetadataGroup = async (documentMetadata, indexMetadata) => {
    const jq = require('node-jq');
    const groupMembers = documentMetadata.group_permissions;
    const legacyGuid = documentMetadata.legacy_guid;
    for (let i = 0; i < groupMembers.length; i++) { 
        console.log("Hey here is the value for the Group members that are in this ACL, permission and group " + groupMembers[i].permissions + ": " + groupMembers[i].group_id);
    }
    
    console.log(groupMembers[0].group_id);
    console.log(groupMembers[1].group_id);
    console.log(groupMembers[2].group_id);
    return {
        'label': "ACL",
        'groupMembers': groupMembers,
        'legacyGuid': legacyGuid,

        //'otherNodes': otherNodes
    };
}
/**
 * Create a new Generic node with dynamically generated properties
 * @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server in gremlin fashion usually, g
 * @param {string} label label for the new node
 * @param {string} properties A list of properties with at least one value that we hope to return
 * @returns {Map} //Returns a Map will the results of the query
 */
 export const addAclVertex = async (gremlinConnection, label, groupMembers, conceptId) => {
    let node = null;
    let groupMemberIdCollection = [];
    let groupPermissionsCollection = []
    try {
        // Build the add vertex command dynamically
        console.log("Here are the group members falling in addAclVertex " + groupMembers);
        for (let i = 0; i < groupMembers.length; i++) {
            groupMemberIdCollection.push(groupMembers[i].group_id)
            groupPermissionsCollection.push(groupMembers[i].permissions)
        }
        console.log(groupMemberIdCollection);
        
        const addVCommand = gremlinConnection.addV(label).property('id',conceptId);

        //Add group permissions and grou members properties to the ACL node
        addVCommand.property('groupMembers', groupMemberIdCollection);
        addVCommand.property('groupPermissions', groupPermissionsCollection);
    
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
        //.addE('Permissions')
        //.property('PermissionValue',"[Read,Write]")
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
 * Create the Edges that Connect the ACL Node to all of the concept nodes that it determines permissions for
 * @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server in gremlin fashion usually, g
 * @param {string} label label for the new node
 * @param {string} properties A list of properties with at least one value that we hope to return
 * @returns {Map} //Returns a Map will the results of the query
 */
 export const addAclEdges = async (gremlinConnection, aclVertexId,aclGroups) => { //we can get the ACL vertex Id from the creator which is run beforehand
    let node = null;
    console.log("The vertex id of the ACL that we are connecting the edge to " + aclVertexId);
    console.log("When adding the ACL, here are the groupss being passed: " + aclGroups);    
    try {
        node = await gremlinConnection
        .V().hasLabel('Grid').has('Groups',gremlinStatistics.unfold().is(GraphPredicate.within('group1'))).as('g') //this returns all the vertexes of type Grid that have groups with group1
        .V(aclVertexId)
        .coalesce(
            gremlinStatistics.outE('Controls').where(gremlinStatistics.inV().as('g')),
            gremlinConnection.addE('Controls').property('Permission',['Read','Write','Order']).to('g')
         )
       .toList()
        } catch (error) {
            //console.log(`Error inserting ${label} node [${conceptId}]:`);
            console.log(error);
            return false;
        }

    const { value = {} } = node;
    const { id: nodeId } = value;
    console.log("This is the value of the node returned from the query" + nodeId);
    //console.log(`Node [${nodeId}] for [${label} - ${conceptId}] successfully inserted into graph db.`);
    return nodeId;
}

/**
 * Add Group ownership to concepts in order to connect them to ACL's
 * @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server in gremlin fashion usually, g
 * @param {String} label the label or "type" of vertex that is having groups added onto it
 * @param {string Array} managedGroups List of the groups that have access to the Concept
 * @param {String} conceptId The unique concept Id identifier to distinguish the unique concept having group information added onto it
 */
 export const addGroupIdGenDoc = async (gremlinConnection, label, managedGroups,conceptId) => {
    let node = null;
    try {
        console.log("This is the value of the groups being added to the Grid node " + managedGroups);
        node = await gremlinConnection
        .V()
        .has(label,'id',conceptId)
        .property('Groups',managedGroups)
        .next()
        } catch (error) {
            console.log(`Error inserting ${label} node [${conceptId}]:`);
            console.log(error);
            return false;
        }

    const { value = {} } = node;
    const { id: nodeId } = value;
    console.log(node);
    //console.log(`Node [${nodeId}] for [${label} - ${conceptId}] successfully inserted into graph db.`);
    return nodeId;
}

/**
 * This function is likely going to be moved to genertic Queries or some sort of testing modeule but, for now remains for informal testing of ACL functionality
 * @param {Gremlin Traversal Object} gremlinConnection connection to gremlin server in gremlin fashion usually, g
 * @param {string} queryLabel label of the Node we are looking for
 * @param {string} allowedGroups As a user you have a list of allowed groups, we can only traverse the graph on vertexes that have one of those groups
 * @returns {Map} //Returns a Map will the results of the query
 */
 export const queryConcepts = async (gremlinConnection, queryLabel, allowedGroups) => {
    let node = null
    try {
        // Dynamically add user tokenization to restrict gremlin queries to a specific user group
        //I need to append which things this can actually see here and limit those based on the ACL
        node = await gremlinConnection
        .V()
        .hasLabel('ACL')
        .has('groupMembers',gremlinStatistics.unfold().is(GraphPredicate.within(allowedGroups))) //The ACL's you are allowed to see
        .outE('Controls') //All of the vertexes under this ACL will be queried
        .has('Permission',gremlinStatistics.unfold().is(GraphPredicate.within('Read'))) //Only the vertexes which have read permissions on it will be left
        .inV() //The vertex being connected to over the permission edge will be returned     
        //.values()
        //.unfold()
        //.union(gremlinStatistics.properties(),gremlinStatistics.values())
        //.valueMap() does not work I am very unsure why that it is. I suspect it may have to do with gremlin 3.4.10
        .toList()

        } catch (error) {
            console.log(error);
            return false;
        }

    const valueMaps = []  = node;
    const { value = {} } = node;
    const { id: nodeId } = value;
   //console.log("Here are the nodes that you were looking for " + Object.values(value)); //Right now this is going to return the list of vertexes that fit the query
    
    //console.log(`Node [${nodeId}] for [${label} - ${conceptId}] successfully searched for vertexes in the graph db.`);
    return node; //we have to return node here honestly I do not know why we have to do that right now
}