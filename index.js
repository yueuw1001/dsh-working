/**
 * Host half of the task monitor bundle.
 *
 * The panel is a pure Client surface: it reads and writes its board in the
 * browser's local storage and renders in the frame-wide overlay slot, so the
 * Host half has no services to register. The bundle still needs this module so
 * the Loader row mounts and the `dsh.client` section can resolve the Client
 * module.
 */
export function apply() {}
