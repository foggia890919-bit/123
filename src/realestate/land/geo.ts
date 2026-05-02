// 최소 GeoJSON 타입 — 외부 의존 없이 폴리곤만 다룬다.

export namespace GeoJSON {
  export interface Polygon {
    type: "Polygon";
    coordinates: number[][][];
  }
  export interface MultiPolygon {
    type: "MultiPolygon";
    coordinates: number[][][][];
  }
}
