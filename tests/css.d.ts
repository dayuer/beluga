/*
 * The root tests load a few of the Mac app's modules, and those import stylesheets for their side
 * effects. The Mac app's own typecheck has
 * vite/client for this; the root's is Node-only, so say here that any stylesheet is fine.
 */
declare module '*.css';
