# Index-list fixture provenance

Synthetic OpenSearch 2.19 and 3.2 wire shapes, not captures. All names and numbers are invented.
CAT returns numeric cells as strings and unavailable statistics as null; closed indices have
empty health. The classification projection contains only the system flag and hidden setting.
Names deliberately distinguish classification from a leading dot.

Sources: [CAT indices](https://docs.opensearch.org/latest/api-reference/cat/cat-indices/),
[2.19 CAT implementation](https://github.com/opensearch-project/OpenSearch/blob/2.19/server/src/main/java/org/opensearch/rest/action/cat/RestIndicesAction.java),
and [2.0 index metadata serialization](https://github.com/opensearch-project/OpenSearch/blob/2.0/server/src/main/java/org/opensearch/cluster/metadata/IndexMetadata.java).
These APIs share the consumed shape across 2.x and 3.x; no 3.9-only system filter is used.
