export interface RRMapVersion {
    major: number;
    minor: number;
}

export interface RRMapHeader {
    header_length: number;
    data_length: number;
    version: RRMapVersion;
    map_index: number;
    map_sequence: number;
}
