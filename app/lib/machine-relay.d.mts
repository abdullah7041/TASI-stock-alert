export function isMachineRoute(request: Request): boolean;
export function isMachineRelay(request: Request, env: { MACHINE_RELAY_SECRET?: string }): boolean;
