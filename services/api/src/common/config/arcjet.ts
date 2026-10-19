export const arcjetKeyFrom = (env: NodeJS.ProcessEnv): string | undefined => {
  const key = env.ARCJET_KEY?.trim();
  return key ? key : undefined;
};
