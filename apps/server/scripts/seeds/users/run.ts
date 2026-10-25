import { userSeed } from "./seed";

try {
  await userSeed();
} catch (error) {
  console.error(error);
  process.exit(1);
} finally {
  process.exit(0);
}
