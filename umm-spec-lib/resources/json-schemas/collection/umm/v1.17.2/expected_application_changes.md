As a consequence of the changes in 1.17.2, applications will need to make the
following changes:

UMM:
  - Change TilingIdentificationSystems/Coordinates so that the Coordinates take strings instead of numbers. Some coordinates use apha-numeric data.
  - Add EULAIdentifiers element so that curators can associate their collections to their End User License Agreements.
CMR:
  - CMR will need to be changed to use the new version schema.
  - Migrating:
    -  UP: migrate TilingIdentificationSystems/Coordinate1 and Coordinate2
    -  DOWN: migrate down if Coordinate1 and Coordinate2 are numbers, otherwise remove it.
             remove EULAIdentifiers from the records.
MMT:
  - MMT will need to allow apha-numeric characters if it doesn't already for the Coordiante elements. 
        Add the EULAIdentifiers array element.
Access:
  - Make sure it can show alpha-numerics for Coordinate1 and Coordinate2.
  - Add the EULAIdentifiers element.
EDSC:
  - no change

Stakeholders:
  - Stakeholders should be notified of the when the new version is ready to be used.

