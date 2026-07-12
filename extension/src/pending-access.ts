export type PendingAccess = { courseHandle: string; email: string; reconnectCredential: string };

type LocalStorage = {
  setAccessLevel?(value: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const keyFor = (courseHandle: string) => `pending-review-access:${courseHandle.toLowerCase()}`;

function normalize(value: PendingAccess): PendingAccess | undefined {
  const courseHandle = value.courseHandle.trim().toLowerCase();
  const normalizedEmail = value.email.trim().toLowerCase();
  const reconnectCredential = value.reconnectCredential.trim();
  if (!uuid.test(courseHandle) || !email.test(normalizedEmail) || normalizedEmail.length > 320 || reconnectCredential.length < 20 || reconnectCredential.length > 128) return undefined;
  return { courseHandle, email: normalizedEmail, reconnectCredential };
}

export class PendingAccessStore {
  private trusted: Promise<void> | undefined;
  private readonly storage: LocalStorage;
  constructor(storage: LocalStorage) { this.storage = storage; }

  private ensureTrusted(): Promise<void> {
    if (!this.trusted) this.trusted = (async () => {
      if (!this.storage.setAccessLevel) throw new Error("Trusted storage is unavailable");
      try { await this.storage.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }); }
      catch { throw new Error("Trusted storage could not be established"); }
    })();
    return this.trusted;
  }

  async save(value: PendingAccess): Promise<void> {
    await this.ensureTrusted();
    const normalized = normalize(value);
    if (!normalized) throw new Error("Invalid pending reviewer access");
    await this.storage.set({ [keyFor(normalized.courseHandle)]: normalized });
  }

  async get(courseHandle: string): Promise<PendingAccess | undefined> {
    await this.ensureTrusted();
    const normalizedCourse = courseHandle.trim().toLowerCase();
    if (!uuid.test(normalizedCourse)) return undefined;
    const key = keyFor(normalizedCourse);
    const stored = (await this.storage.get(key))[key];
    if (!stored || typeof stored !== "object") return undefined;
    const candidate = stored as Record<string, unknown>;
    if (Object.keys(candidate).sort().join(",") !== "courseHandle,email,reconnectCredential" || typeof candidate.courseHandle !== "string" || typeof candidate.email !== "string" || typeof candidate.reconnectCredential !== "string") {
      await this.storage.remove(key); return undefined;
    }
    const value = normalize(candidate as PendingAccess);
    if (!value || value.courseHandle !== normalizedCourse) { await this.storage.remove(key); return undefined; }
    return value;
  }

  async remove(courseHandle: string): Promise<void> {
    await this.ensureTrusted();
    if (uuid.test(courseHandle.trim())) await this.storage.remove(keyFor(courseHandle.trim().toLowerCase()));
  }
}

type ResumedAccess = { state: string; session?: { apiToken: string; expiresAt: number }; deviceCredential?: string };
type ApprovalState = { state: "none" | "pending" | "connected" };

export class PendingApprovalManager {
  private readonly inFlight = new Map<string, Promise<ApprovalState>>();
  private readonly store: PendingAccessStore;
  private readonly resume: (record: PendingAccess) => Promise<ResumedAccess>;
  private readonly connect: (access: ResumedAccess, record: PendingAccess) => Promise<void>;
  constructor(
    store: PendingAccessStore,
    resume: (record: PendingAccess) => Promise<ResumedAccess>,
    connect: (access: ResumedAccess, record: PendingAccess) => Promise<void>,
  ) { this.store = store; this.resume = resume; this.connect = connect; }

  check(courseHandle: string): Promise<ApprovalState> {
    const key = courseHandle.trim().toLowerCase();
    const current = this.inFlight.get(key);
    if (current) return current;
    const operation = this.run(key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  private async run(courseHandle: string): Promise<ApprovalState> {
    const record = await this.store.get(courseHandle);
    if (!record) return { state: "none" };
    try {
      const access = await this.resume(record);
      if (!access.session || !access.deviceCredential) return { state: "pending" };
      await this.connect(access, record);
      await this.store.remove(courseHandle);
      return { state: "connected" };
    } catch { return { state: "pending" }; }
  }
}
