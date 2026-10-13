import { Color, Vector2 } from 'three';

// Final full-screen pass: chromatic aberration, radial zoom blur, flash,
// ACES tone mapping, grading, vignette, low-HP danger glow, sRGB encode and grain.
export const FinalShader = {
  name: 'FinalShader',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new Vector2(1, 1) },
    uTime: { value: 0 },
    uExposure: { value: 1.0 },
    uAberration: { value: 0.15 },
    uFlash: { value: 0 },
    uFlashColor: { value: new Color(1, 1, 1) },
    uVignette: { value: 1.0 },
    uDanger: { value: 0 },
    uDangerColor: { value: new Color(1.0, 0.04, 0.12) },
    uZoomBlur: { value: 0 },
    uZoomCenter: { value: new Vector2(0.5, 0.5) },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.06 },
    uGrain: { value: 0.035 },
    uDesaturate: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uExposure;
    uniform float uAberration;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform float uVignette;
    uniform float uDanger;
    uniform vec3 uDangerColor;
    uniform float uZoomBlur;
    uniform vec2 uZoomCenter;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uGrain;
    uniform float uDesaturate;
    varying vec2 vUv;

    vec3 RRTAndODTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 acesFilmic(vec3 color) {
      const mat3 ACESInputMat = mat3(
        vec3(0.59719, 0.07600, 0.02840),
        vec3(0.35458, 0.90834, 0.13383),
        vec3(0.04823, 0.01566, 0.83777)
      );
      const mat3 ACESOutputMat = mat3(
        vec3( 1.60475, -0.10208, -0.00327),
        vec3(-0.53108,  1.10813, -0.07276),
        vec3(-0.07367, -0.00605,  1.07602)
      );
      color = ACESInputMat * (color / 0.6);
      color = RRTAndODTFit(color);
      color = ACESOutputMat * color;
      return clamp(color, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) {
      return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
    }
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec3 sampleCA(vec2 uv) {
      vec2 dir = uv - 0.5;
      vec2 off = dir * dot(dir, dir) * uAberration * 0.09;
      float r = texture2D(tDiffuse, uv - off).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv + off).b;
      return vec3(r, g, b);
    }

    void main() {
      vec3 col;
      if (uZoomBlur > 0.001) {
        vec2 toC = uZoomCenter - vUv;
        float total = 0.0;
        col = vec3(0.0);
        for (int i = 0; i < 10; i++) {
          float t = float(i) / 9.0;
          float w = 1.0 - t * 0.75;
          col += sampleCA(vUv + toC * t * uZoomBlur * 0.22) * w;
          total += w;
        }
        col /= total;
      } else {
        col = sampleCA(vUv);
      }

      col *= uExposure;
      col += uFlashColor * uFlash;
      col = acesFilmic(col);

      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation * (1.0 - uDesaturate));

      vec2 q = vUv - 0.5;
      q.x *= uResolution.x / uResolution.y;
      float vig = mix(1.0, 0.32, smoothstep(0.42, 1.3, length(q)));
      col *= mix(1.0, vig, uVignette);

      float edge = smoothstep(0.45, 1.15, length(q * vec2(0.8, 1.35)));
      col += uDangerColor * edge * uDanger;

      col = toSRGB(clamp(col, 0.0, 1.0));
      col = (col - 0.5) * uContrast + 0.5;

      float n = hash12(vUv * uResolution + fract(uTime * 7.31) * 517.0) - 0.5;
      col += n * uGrain;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};
