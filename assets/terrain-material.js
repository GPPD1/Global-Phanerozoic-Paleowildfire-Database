import * as THREE from 'three';

// Two byte channels preserve every signed metre in the native DEM. Linear
// filtering remains valid because decoding is a linear combination of channels.
export function makeElevationTexture(grid) {
  const data = new Uint8Array(grid.values.length * 2);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const value = grid.values[y * grid.width + x] + 32768;
      const i = ((grid.height - 1 - y) * grid.width + x) * 2;
      data[i] = value >> 8;
      data[i + 1] = value & 255;
    }
  }
  const texture = new THREE.DataTexture(data, grid.width, grid.height, THREE.RGFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function configureTerrainMaterial(material) {
  const uniforms = {
    nativeDEM: {value: null}, demSize: {value: new THREE.Vector2(3601, 1801)},
    terrainScale: {value: 18}, terrainShading: {value: false}, seafloorShading: {value: true}
  };
  material.userData.terrainUniforms = uniforms;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vTerrainRadial;
      varying vec3 vTerrainEast;
      varying vec3 vTerrainNorth;`);
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      float lon = (uv.x - 0.5) * 6.28318530718;
      float lat = (uv.y - 0.5) * 3.14159265359;
      vTerrainRadial = normalMatrix * vec3(cos(lat)*cos(lon), sin(lat), -cos(lat)*sin(lon));
      vTerrainEast = normalMatrix * vec3(-sin(lon), 0.0, -cos(lon));
      vTerrainNorth = normalMatrix * vec3(-sin(lat)*cos(lon), cos(lat), sin(lat)*sin(lon));`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D nativeDEM;
      uniform vec2 demSize;
      uniform float terrainScale;
      uniform bool terrainShading;
      uniform bool seafloorShading;
      varying vec3 vTerrainRadial;
      varying vec3 vTerrainEast;
      varying vec3 vTerrainNorth;
      float elevationAt(vec2 uv) {
        vec2 coord = vec2(fract(uv.x), clamp(uv.y, 0.0, 1.0));
        coord = (coord * (demSize - 1.0) + 0.5) / demSize;
        vec2 encoded = texture2D(nativeDEM, coord).rg;
        float z = dot(encoded, vec2(65280.0, 255.0)) - 32768.0;
        return seafloorShading ? z : max(0.0, z);
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      #ifdef USE_MAP
      if (terrainShading) {
        vec2 stepUV = 1.0 / (demSize - 1.0);
        float east = elevationAt(vMapUv + vec2(stepUV.x, 0.0)) - elevationAt(vMapUv - vec2(stepUV.x, 0.0));
        float north = elevationAt(vMapUv + vec2(0.0, stepUV.y)) - elevationAt(vMapUv - vec2(0.0, stepUV.y));
        float lat = (vMapUv.y - 0.5) * 3.14159265359;
        float slopeE = east * terrainScale / (2.0 * 6371000.0 * 6.28318530718 * stepUV.x * max(0.02, cos(lat)));
        float slopeN = north * terrainScale / (2.0 * 6371000.0 * 3.14159265359 * stepUV.y);
        normal = normalize(vTerrainRadial - slopeE * vTerrainEast - slopeN * vTerrainNorth);
      }
      #endif`);
  };
  material.customProgramCacheKey = () => 'native-dem-normals-v1';
}
