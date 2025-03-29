
declare global {
  namespace NodeJS {
    interface ProcessEnv {
			DOMAIN_NAME: string;
    }
  }
}
export {};