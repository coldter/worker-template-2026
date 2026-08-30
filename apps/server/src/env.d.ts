declare global {
  // biome-ignore lint/style/noNamespace: required for NodeJS.ProcessEnv augmentation
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: string;
    }
  }
}

export type {};
