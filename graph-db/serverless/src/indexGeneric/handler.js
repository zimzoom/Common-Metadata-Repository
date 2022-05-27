import 'array-foreach-async'

import { getEchoToken } from '../utils/cmr/getEchoToken'
import { initializeGremlinConnection } from '../utils/gremlin/initializeGremlinConnection'

let gremlinConnection
let token

const indexGenerics = async (event) => {
    // Prevent creating more tokens than necessary
    if (token === undefined) {
        token = await getEchoToken()
    }

    // Prevent connecting to Gremlin more than necessary
    if (!gremlinConnection) {
        gremlinConnection = initializeGremlinConnection()
        }

    const { Name: genericName } = event

    const mockIndex = require('../../../grid-index.json')

    const { PropertyFields: propertyFields,
            EntityFields: entityFields } = mockIndex

    return {
        isBase64Encoded: false,
        statusCode: 200,
        genericName,
        propertyFields,
        entityFields
      }

}



export default indexGenerics