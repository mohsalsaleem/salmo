// Some upstream tests import the directory (`../../src`) rather than
// `../../src/wrapper.js`. Re-export from the shim so both paths resolve.
export { Signal } from './wrapper.js';
