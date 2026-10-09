export class OmniError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "OmniError";
    this.code = code;
    this.status = status;
  }
}
