import { run } from "./action/run";

export { run };

if (require.main === module) {
  void run();
}
