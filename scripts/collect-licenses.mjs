import { mkdir, readFile, writeFile } from "node:fs/promises";

const packages = ["react", "react-dom", "scheduler", "lucide-react"];
const sections = await Promise.all(
  packages.map(async (name) => {
    const root = new URL(`../node_modules/${name}/`, import.meta.url);
    const metadata = JSON.parse(
      await readFile(new URL("package.json", root), "utf8"),
    );
    const license = await readFile(new URL("LICENSE", root), "utf8");
    return `${name} ${metadata.version}\n${"=".repeat(60)}\n${license.trim()}\n`;
  }),
);
const destination = new URL("../web/public/licenses/", import.meta.url);
await mkdir(destination, { recursive: true });
await writeFile(
  new URL("frontend.txt", destination),
  "Third-party notices for the PayWella AI web bundle\n\n" +
    sections.join("\n"),
);
