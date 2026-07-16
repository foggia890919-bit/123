/* 문서 자동 감지 워커 (순수 JS).
 *
 * 이 파일 안에서만 OpenCV.js 를 로드/컴파일/실행한다. 즉 10.96MB opencv.js 의
 * WASM 컴파일과 모든 cv.* 이미지 연산이 워커 스레드에서 일어나므로 메인(UI)
 * 스레드는 절대 블로킹되지 않는다. 메인은 축소된 RGBA 데이터를 postMessage 로
 * 넘기고 코너 4점 + 회전여부만 돌려받는다.
 *
 * 메시지 프로토콜
 *   ← 메인: { id, buffer(ArrayBuffer, RGBA), width, height }
 *   → 메인: { id, corners: [[x,y]x4] | null (0~1 정규화), shouldRotate: boolean }
 */

/* eslint-disable no-var */

// opencv.js 는 UMD 로 importScripts 분기를 지원한다 → self.cv 에 Module 이 붙는다.
// 이 importScripts 호출이 WASM 을 컴파일하지만 여기가 워커 스레드이므로 UI 와 무관.
try {
  self.importScripts("/opencv/opencv.js");
} catch (e) {
  // opencv 로드 자체 실패 — cv 없이도 회전 휴리스틱은 동작하도록 아래에서 처리.
}

// cv 런타임 준비 Promise. 빌드별 편차(Promise 형/onRuntimeInitialized 형/이미 준비됨)를 모두 커버.
var cvReady = new Promise(function (resolve, reject) {
  try {
    var cv = self.cv;
    if (!cv) {
      reject(new Error("cv-missing"));
      return;
    }
    // (1) 신형 MODULARIZE: cv 가 thenable
    if (typeof cv.then === "function") {
      cv.then(
        function (real) {
          self.cv = real;
          resolve();
        },
        function (err) {
          reject(err);
        }
      );
      return;
    }
    // (2) 이미 초기화됨
    if (typeof cv.Mat === "function") {
      resolve();
      return;
    }
    // (3) 런타임 초기화 콜백 대기
    cv.onRuntimeInitialized = function () {
      resolve();
    };
  } catch (e) {
    reject(e);
  }
});

// ─────────── 4점을 TL,TR,BR,BL 순서로 정렬 ───────────
function orderPoints(pts) {
  var tl = pts[0], br = pts[0], tr = pts[0], bl = pts[0];
  var minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    var sum = p.x + p.y;
    var diff = p.y - p.x;
    if (sum < minSum) { minSum = sum; tl = p; }
    if (sum > maxSum) { maxSum = sum; br = p; }
    if (diff < minDiff) { minDiff = diff; tr = p; }
    if (diff > maxDiff) { maxDiff = diff; bl = p; }
  }
  return [tl, tr, br, bl];
}

// ─────────── 문서 4각형 감지 (cv 필요) ───────────
// imageDataLike: { data:Uint8ClampedArray(RGBA), width, height }
// 반환: [[x,y]x4] (0~1 정규화, TL,TR,BR,BL) 또는 null. 예외는 던지지 않는다.
function detectCorners(cv, imageDataLike, cw, ch) {
  var totalArea = cw * ch;
  var src = null, gray = null, blurred = null, edges = null, kernel = null;
  var contours = null, hierarchy = null;
  var approxPool = [];
  try {
    src = cv.matFromImageData(imageDataLike);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    edges = new cv.Mat();
    cv.Canny(blurred, edges, 75, 200);
    kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, edges, kernel);

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    var n = contours.size();
    var items = [];
    for (var i = 0; i < n; i++) {
      var c0 = contours.get(i);
      var a0 = cv.contourArea(c0, false);
      c0.delete();
      items.push({ idx: i, area: a0 });
    }
    items.sort(function (a, b) { return b.area - a.area; });

    var best = null;
    var bestArea = 0;
    for (var k = 0; k < items.length && k < 8; k++) {
      var idx = items[k].idx;
      var area = items[k].area;
      if (area < totalArea * 0.3) break; // 정렬돼 있으니 더 볼 필요 없음
      var cnt = contours.get(idx);
      var peri = cv.arcLength(cnt, true);
      var approx = new cv.Mat();
      approxPool.push(approx);
      cv.approxPolyDP(cnt, approx, peri * 0.02, true);
      cnt.delete();
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        var pts = [];
        for (var r = 0; r < 4; r++) {
          pts.push({ x: approx.data32S[r * 2], y: approx.data32S[r * 2 + 1] });
        }
        if (area > bestArea) { bestArea = area; best = pts; }
      }
    }

    if (!best || bestArea < totalArea * 0.3) return null;

    var ordered = orderPoints(best);
    return ordered.map(function (p) {
      return [
        Math.min(1, Math.max(0, p.x / cw)),
        Math.min(1, Math.max(0, p.y / ch)),
      ];
    });
  } catch (e) {
    return null;
  } finally {
    for (var ap = 0; ap < approxPool.length; ap++) {
      try { approxPool[ap].delete(); } catch (e) { /* noop */ }
    }
    var all = [src, gray, blurred, edges, kernel, contours, hierarchy];
    for (var m = 0; m < all.length; m++) {
      try { if (all[m]) all[m].delete(); } catch (e) { /* noop */ }
    }
  }
}

// ─────────── 90도 회전 필요 여부 (순수 JS 투영 분산) ───────────
// data: RGBA Uint8ClampedArray (cw x ch). cornersNorm: [[x,y]x4] 또는 null.
// 코너가 있으면 그 바운딩박스, 없으면 전체를 대상으로 긴 변 400 이하로 서브샘플해
// 행/열 밝기 프로파일 분산을 비교. 세로 방향 줄무늬 우세면 회전 권장.
function detectRotation(data, cw, ch, cornersNorm) {
  try {
    var minX = 0, minY = 0, maxX = cw, maxY = ch;
    if (cornersNorm) {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
      for (var i = 0; i < cornersNorm.length; i++) {
        var px = cornersNorm[i][0] * cw;
        var py = cornersNorm[i][1] * ch;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
    var x0 = Math.max(0, Math.floor(minX));
    var y0 = Math.max(0, Math.floor(minY));
    var x1 = Math.min(cw, Math.ceil(maxX));
    var y1 = Math.min(ch, Math.ceil(maxY));
    var bw = Math.max(1, x1 - x0);
    var bh = Math.max(1, y1 - y0);

    // 긴 변 400 이하가 되도록 서브샘플 stride 결정.
    var stride = Math.max(1, Math.ceil(Math.max(bw, bh) / 400));
    var cols = Math.max(1, Math.floor(bw / stride));
    var rows = Math.max(1, Math.floor(bh / stride));

    var rowMean = new Float64Array(rows);
    var colMean = new Float64Array(cols);
    for (var ry = 0; ry < rows; ry++) {
      var sy = y0 + ry * stride;
      var rowSum = 0;
      for (var rx = 0; rx < cols; rx++) {
        var sx = x0 + rx * stride;
        var idx = (sy * cw + sx) * 4;
        var g = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        rowSum += g;
        colMean[rx] += g;
      }
      rowMean[ry] = rowSum / cols;
    }
    for (var cc = 0; cc < cols; cc++) colMean[cc] /= rows;

    var variance = function (arr) {
      var mean = 0;
      for (var a = 0; a < arr.length; a++) mean += arr[a];
      mean /= arr.length;
      var v = 0;
      for (var b = 0; b < arr.length; b++) {
        var d = arr[b] - mean;
        v += d * d;
      }
      return v / arr.length;
    };

    var varRow = variance(rowMean);
    var varCol = variance(colMean);
    // 열 방향 변동이 명확히 우세할 때만 회전 권장.
    return varCol > varRow * 1.5;
  } catch (e) {
    return false;
  }
}

self.onmessage = function (e) {
  var msg = e.data || {};
  var id = msg.id;
  var width = msg.width;
  var height = msg.height;
  var imageDataLike = {
    data: new Uint8ClampedArray(msg.buffer),
    width: width,
    height: height,
    colorSpace: "srgb",
  };

  cvReady.then(
    function () {
      var cv = self.cv;
      var corners = null;
      try {
        corners = detectCorners(cv, imageDataLike, width, height);
      } catch (err) {
        corners = null;
      }
      var shouldRotate = detectRotation(imageDataLike.data, width, height, corners);
      self.postMessage({ id: id, corners: corners, shouldRotate: shouldRotate });
    },
    function () {
      // cv 준비 실패 — 코너는 못 잡아도 회전 휴리스틱은 순수 JS 라 여전히 가능.
      var shouldRotate = detectRotation(imageDataLike.data, width, height, null);
      self.postMessage({ id: id, corners: null, shouldRotate: shouldRotate });
    }
  );
};
