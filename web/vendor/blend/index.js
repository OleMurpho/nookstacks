import * as THREE from "three";
import { decompress as zstdDecompress } from "fzstd";
import parser from "./parser.js";
const ZSTD_MAGIC = [40, 181, 47, 253];
const GZIP_MAGIC = [31, 139];
async function parseBlend(buffer, name = "") {
  let data = buffer;
  const magic = new Uint8Array(buffer, 0, 4);
  if (ZSTD_MAGIC.every((b, i) => magic[i] === b)) {
    data = zstdDecompress(new Uint8Array(buffer)).buffer;
  } else if (GZIP_MAGIC.every((b, i) => magic[i] === b)) {
    data = await new Response(
      new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"))
    ).arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    parser.onParseReady = (file, error) => {
      if (!file || error) reject(new Error(error ?? "Not a valid .blend file"));
      else resolve(file);
    };
    try {
      parser.loadBlendFromArrayBuffer(data, name);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
const BLEND_OBJECT_TYPES = { empty: 0, mesh: 1, lamp: 10, camera: 11 };
const BLEND_LIGHT_TYPES = { point: 0, sun: 1, spot: 2, hemi: 3, area: 4 };
const EULER_MODES = {
  1: "XYZ",
  2: "XZY",
  3: "YXZ",
  4: "YZX",
  5: "ZXY",
  6: "ZYX"
};
function getLayer(layers, i) {
  return Array.isArray(layers) ? layers[i] : layers;
}
function readInt32s(file, address, count) {
  const out = new Int32Array(count);
  const ab = file.AB;
  const littleEndian = true;
  if (address % 4 === 0 && littleEndian) {
    return new Int32Array(ab, address, count);
  }
  const dv = new DataView(ab);
  for (let i = 0; i < count; i++) out[i] = dv.getInt32(address + i * 4, littleEndian);
  return out;
}
function createBufferGeometry(meshData) {
  if (meshData.mpoly) return createBufferGeometryLegacy(meshData);
  const geometry = new THREE.BufferGeometry();
  geometry.name = meshData.aname || "";
  let vertices, verticesData;
  let indices, indicesData;
  if (meshData.vdata?.layers && meshData.vdata.totlayer > 0) {
    for (let i = 0; i < meshData.vdata.totlayer; i++) {
      const layer = getLayer(meshData.vdata.layers, i);
      const data = layer.data || [];
      if (data.length === meshData.totvert) {
        if (vertices && (layer.name !== "position" || vertices.name === "position")) continue;
        vertices = layer;
        verticesData = data;
      }
    }
  }
  if (meshData.ldata?.layers) {
    for (let i = 0; i < meshData.ldata.totlayer; i++) {
      const layer = getLayer(meshData.ldata.layers, i);
      const data = layer.data || [];
      if (data.length === meshData.totloop) {
        if (indices && (layer.name !== ".corner_vert" || indices.name === ".corner_vert")) continue;
        indices = layer;
        indicesData = data;
      }
    }
  }
  let faceIndices = [];
  if (meshData.poly_offset_indices && meshData.totpoly > 0) {
    const offsets = readInt32s(
      meshData.poly_offset_indices.__blender_file__,
      meshData.poly_offset_indices.__data_address__,
      meshData.totpoly + 1
    );
    faceIndices = [...offsets];
  }
  if (verticesData && verticesData.length > 0) {
    const positions = new Float32Array(verticesData.length * 3);
    for (let j = 0; j < verticesData.length; j++) {
      const { x, y, z, co } = verticesData[j] || {};
      if (x !== void 0) {
        positions[j * 3] = x;
        positions[j * 3 + 1] = z;
        positions[j * 3 + 2] = -y;
      } else if (co !== void 0) {
        positions[j * 3] = co[0];
        positions[j * 3 + 1] = co[2];
        positions[j * 3 + 2] = -co[1];
      } else break;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  }
  if (indicesData && indicesData.length > 0 && verticesData?.length) {
    if (faceIndices.length > 0) {
      let totalTriangles = 0;
      for (let i = 0; i < faceIndices.length - 1; i++)
        totalTriangles += Math.max(0, faceIndices[i + 1] - faceIndices[i] - 2);
      const indexes = new Uint32Array(totalTriangles * 3);
      let t = 0;
      for (let i = 0; i < faceIndices.length - 1; i++) {
        const start = faceIndices[i];
        const count = faceIndices[i + 1] - start;
        if (count >= 3) {
          const firstVert = indicesData[start].i;
          for (let k = 1; k < count - 1; k++) {
            indexes[t++] = firstVert;
            indexes[t++] = indicesData[start + k].i;
            indexes[t++] = indicesData[start + k + 1].i;
          }
        }
      }
      geometry.setIndex(new THREE.BufferAttribute(indexes, 1));
    } else {
      const faceSize = meshData.totloop / meshData.totpoly;
      if (faceSize === 3 || faceSize === 4) {
        const isQuad = faceSize === 4;
        const faceCount = indicesData.length / faceSize;
        const indexes = new Uint32Array(faceCount * 3 * (isQuad ? 2 : 1));
        for (let j = 0, t = 0; j < indicesData.length; j += faceSize) {
          const a = indicesData[j].i;
          const b = indicesData[j + 1].i;
          const c = indicesData[j + 2].i;
          indexes[t++] = a;
          indexes[t++] = b;
          indexes[t++] = c;
          if (isQuad) {
            indexes[t++] = a;
            indexes[t++] = c;
            indexes[t++] = indicesData[j + 3].i;
          }
        }
        geometry.setIndex(new THREE.BufferAttribute(indexes, 1));
      }
    }
  }
  if (geometry.attributes.position && !geometry.attributes.normal)
    geometry.computeVertexNormals();
  return geometry;
}
function createBufferGeometryLegacy(mesh) {
  const faces = Array.isArray(mesh.mpoly) ? mesh.mpoly : [mesh.mpoly];
  const loops = mesh.mloop;
  const uvs = mesh.mloopuv;
  const verts = mesh.mvert;
  const geometry = new THREE.BufferGeometry();
  if (!faces) return geometry;
  const size = faces.reduce((acc, f) => acc + Math.floor(f.totloop * 3 / 2), 0);
  const indices = new Uint32Array(size);
  const uvArr = new Float32Array(size * 2);
  const normals = new Float32Array(size * 3);
  const positions = new Float32Array(size * 3);
  let cur = 0;
  let computeNormals = false;
  for (const face of faces) {
    const len = face.totloop;
    const start = face.loopstart;
    let idx = 1;
    while (idx < len) {
      for (let l = 0; l < 3; l++) {
        let index = start;
        if (idx - 1 + l < len) index += idx - 1 + l;
        const loop = loops[index];
        const { co, no } = verts[loop.v] || {};
        indices[cur] = cur;
        if (co) {
          positions[cur * 3] = co[0];
          positions[cur * 3 + 1] = co[2];
          positions[cur * 3 + 2] = -co[1];
        }
        if (no) {
          normals[cur * 3] = no[0];
          normals[cur * 3 + 1] = no[2];
          normals[cur * 3 + 2] = -no[1];
        } else computeNormals = true;
        if (uvs) {
          uvArr[cur * 2] = uvs[index].uv[0];
          uvArr[cur * 2 + 1] = uvs[index].uv[1];
        }
        cur++;
      }
      idx += 2;
    }
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvArr, 2));
  if (computeNormals) geometry.computeVertexNormals();
  return geometry;
}
function createMaterial(mat) {
  const material = new THREE.MeshPhysicalMaterial();
  material.color.setRGB(mat.r ?? 0.8, mat.g ?? 0.8, mat.b ?? 0.8);
  material.roughness = mat.roughness !== void 0 ? mat.roughness : 0.4;
  material.metalness = mat.metallic !== void 0 ? mat.metallic : 0;
  material.opacity = 1;
  material.transparent = false;
  material.name = mat.aname || "";
  return material;
}
function createLight(lamp) {
  const d = lamp.data;
  if (!d) return void 0;
  const color = new THREE.Color(d.r, d.g, d.b);
  const intensity = d.energy;
  switch (d.type) {
    case BLEND_LIGHT_TYPES.sun: {
      const light = new THREE.DirectionalLight(color, intensity / 10);
      light.position.set(lamp.loc[0], lamp.loc[2], -lamp.loc[1]);
      light.castShadow = true;
      return light;
    }
    case BLEND_LIGHT_TYPES.spot: {
      const angle = (d.spot_size ?? Math.PI) / 2;
      const light = new THREE.SpotLight(color, intensity, 0, angle, d.spot_blend ?? 0.2);
      light.position.set(lamp.loc[0], lamp.loc[2], -lamp.loc[1]);
      light.castShadow = true;
      return light;
    }
    case BLEND_LIGHT_TYPES.point:
    default: {
      const light = new THREE.PointLight(color, intensity, 0);
      light.position.set(lamp.loc[0], lamp.loc[2], -lamp.loc[1]);
      light.castShadow = true;
      return light;
    }
  }
}
function createCamera(object) {
  const d = object.data;
  if (!d) return void 0;
  if (d.type === 1) {
    const scale = d.ortho_scale || 1;
    const aspect = (d.sensor_x || 36) / (d.sensor_y || 24);
    return new THREE.OrthographicCamera(
      -scale * aspect / 2,
      scale * aspect / 2,
      scale / 2,
      -scale / 2,
      d.clipsta || 0.1,
      d.clipend || 1e3
    );
  }
  const sensorHeight = d.sensor_y || 24;
  const lens = d.lens || 50;
  const fov = 2 * Math.atan(sensorHeight / (2 * lens)) * 180 / Math.PI;
  return new THREE.PerspectiveCamera(fov, (d.sensor_x || 36) / sensorHeight, d.clipsta || 0.1, d.clipend || 1e3);
}
function safeVec(v, fallback) {
  return Array.isArray(v) && v.length >= 3 ? v : fallback;
}
function setTransform(object, obj) {
  obj.name = object.aname;
  const size = safeVec(object.size, [1, 1, 1]);
  const loc = safeVec(object.loc, [0, 0, 0]);
  const rot = safeVec(object.rot, [0, 0, 0]);
  obj.scale.set(size[0], size[2], size[1]);
  obj.position.set(loc[0], loc[2], -loc[1]);
  const quat = object.quat;
  if ((!object.rotmode || object.rotmode === 0) && Array.isArray(quat) && quat.length >= 4) {
    obj.quaternion.set(quat[1], quat[3], -quat[2], quat[0]);
  } else {
    const order = EULER_MODES[object.rotmode] ?? "XYZ";
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        rot[0],
        rot[1],
        rot[2],
        order.split("").reverse().join("")
      )
    );
    obj.quaternion.set(q.x, q.z, -q.y, q.w);
  }
  if (object.type === BLEND_OBJECT_TYPES.camera)
    obj.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
  obj.updateMatrix();
}
function createObjects(file) {
  const objects = [];
  const childMap = /* @__PURE__ */ new Map();
  const objMap = /* @__PURE__ */ new Map();
  const blendObjects = file.objects.Object ?? [];
  const loadedGeo = /* @__PURE__ */ new Map();
  const loadedMat = /* @__PURE__ */ new Map();
  for (const object of blendObjects) {
    let obj;
    switch (object.type) {
      case BLEND_OBJECT_TYPES.mesh: {
        if (!object.data) break;
        let geo = loadedGeo.get(object.data);
        if (!geo) {
          geo = createBufferGeometry(object.data);
          loadedGeo.set(object.data, geo);
        }
        const mat = object.data.mat?.[0];
        let material;
        if (mat) {
          material = loadedMat.get(mat) ?? createMaterial(mat);
          loadedMat.set(mat, material);
        } else {
          material = createMaterial({});
        }
        const mesh = new THREE.Mesh(geo, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        obj = mesh;
        break;
      }
      case BLEND_OBJECT_TYPES.lamp:
        obj = createLight(object);
        break;
      case BLEND_OBJECT_TYPES.camera:
        obj = createCamera(object);
        break;
      default:
        obj = new THREE.Object3D();
    }
    if (!obj) continue;
    setTransform(object, obj);
    const pending = childMap.get(object);
    if (pending) {
      for (const child of pending) obj.add(child);
      childMap.delete(object);
    }
    objMap.set(object, obj);
    if (object.parent === object || !object.parent) {
      objects.push(obj);
    } else {
      const parent = objMap.get(object.parent);
      if (parent) parent.add(obj);
      else {
        const list = childMap.get(object.parent) ?? [];
        list.push(obj);
        childMap.set(object.parent, list);
      }
    }
  }
  if (childMap.size) objects.push(...[...childMap.values()].flat());
  return objects.filter((o) => !!o);
}
export {
  createBufferGeometry,
  createObjects,
  parseBlend
};
