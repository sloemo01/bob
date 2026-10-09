// typebob: build the shared body-ring set in a module worker so the ~3s of
// fit iteration (fitRingPts/ringMargin, inside mkDiamond/mkTriangle/…) never
// runs on the main thread. It used to land lazily inside the first non-circle
// body render — the auto tour's first step — and freeze the typing for ~3s.
// App.jsx posts the result straight into morph.js's adoptRingSet().
import { warmRingSet } from "./morph.js";

postMessage(warmRingSet());
