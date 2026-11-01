# Index-list fixture provenance

Synthetic OpenSearch 2.19 and 3.2 wire shapes, not captures. All names and numbers are invented.
CAT returns numeric cells as strings and unavailable statistics as null; closed indices have
empty health. The classification projection contains only the system flag and hidden setting.
Names deliberately distinguish classification from a leading dot.

Sources: the official CAT indices documentation, 2.19 CAT implementation and 2.0 metadata
serialization linked in [testing](../../../docs/testing.md#index-list-fixtures).
These APIs share the consumed shape across 2.x and 3.x; no 3.9-only system filter is used.
