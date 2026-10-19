import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = `${process.env.DATABASE_URL}`;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DEFAULT_TEACHER_EMAIL = "seed.teacher@reducera.local";
const DEFAULT_FILE = "akuntansi-usaha-dagang.topic.json";

interface SeedStep {
  title: string;
  description: string;
}

interface SeedLesson {
  title: string;
  description: string;
  steps: SeedStep[];
}

interface SeedSubTopic {
  slug: string;
  title: string;
  description: string;
  prerequisites: string[];
  lessons: SeedLesson[];
}

interface SeedTopic {
  slug: string;
  title: string;
  category: string;
  description: string;
  durationMinutes: number;
  subTopics: SeedSubTopic[];
}

function readTopic(): SeedTopic {
  const file = process.env.SEED_TOPIC_FILE || DEFAULT_FILE;
  const topic = JSON.parse(fs.readFileSync(path.resolve(__dirname, "seed-data", file), "utf8")) as SeedTopic;
  const slugs = new Set(topic.subTopics.map((sub) => sub.slug));
  for (const sub of topic.subTopics) {
    for (const required of sub.prerequisites) {
      if (!slugs.has(required)) {
        throw new Error(`sub-topic "${sub.slug}" requires unknown sub-topic "${required}"`);
      }
    }
    if (sub.lessons.some((lesson) => lesson.steps.length === 0)) {
      throw new Error(`sub-topic "${sub.slug}" has a lesson without steps`);
    }
  }
  return topic;
}

async function findTeacher() {
  const email = (process.env.SEED_TOPIC_TEACHER_EMAIL?.trim() || DEFAULT_TEACHER_EMAIL).toLowerCase();
  const named = await prisma.user.findUnique({ where: { email } });
  if (named) return named;
  const anyTeacher = await prisma.user.findFirst({ where: { role: "TEACHER" }, orderBy: { createdAt: "asc" } });
  if (!anyTeacher) {
    throw new Error("No TEACHER user found; run `pnpm seed` first to create the base users.");
  }
  return anyTeacher;
}

async function main(): Promise<void> {
  const seed = readTopic();
  if (await prisma.topic.findUnique({ where: { slug: seed.slug } })) {
    console.log(`topic "${seed.slug}" already exists, nothing to do`);
    return;
  }

  const teacher = await findTeacher();
  const category = await prisma.category.upsert({
    where: { name: seed.category },
    update: {},
    create: { name: seed.category },
  });

  const counts = await prisma.$transaction(async (tx) => {
    const topic = await tx.topic.create({
      data: {
        title: seed.title,
        slug: seed.slug,
        description: seed.description,
        image: {},
        price: 0,
        topicDuration: seed.durationMinutes,
        isVerified: true,
        categories: { connect: [{ id: category.id }] },
        teacher: { connect: { id: teacher.id } },
      },
    });

    const subTopicIds = new Map<string, string>();
    let lessons = 0;
    let steps = 0;

    for (const [subIndex, sub] of seed.subTopics.entries()) {
      const createdSub = await tx.subTopic.create({
        data: { title: sub.title, description: sub.description, sortOrder: subIndex + 1, topicId: topic.id },
      });
      subTopicIds.set(sub.slug, createdSub.id);

      for (const [lessonIndex, lesson] of sub.lessons.entries()) {
        const createdLesson = await tx.lesson.create({
          data: { title: lesson.title, description: lesson.description, sortOrder: lessonIndex + 1, subTopicId: createdSub.id },
        });
        lessons += 1;

        for (const [stepIndex, step] of lesson.steps.entries()) {
          await tx.step.create({
            data: { title: step.title, description: step.description, sortOrder: stepIndex + 1, lessonId: createdLesson.id },
          });
          steps += 1;
        }
      }
    }

    let prerequisites = 0;
    for (const sub of seed.subTopics) {
      for (const required of sub.prerequisites) {
        await tx.subTopicPrerequisite.create({
          data: { subTopicId: subTopicIds.get(sub.slug)!, requiresId: subTopicIds.get(required)! },
        });
        prerequisites += 1;
      }
    }

    return { subTopics: seed.subTopics.length, lessons, steps, prerequisites, topicId: topic.id };
  });

  console.log(
    `seeded topic "${seed.slug}" (${counts.topicId}): ${counts.subTopics} sub-topics, ${counts.lessons} lessons, ${counts.steps} steps, ${counts.prerequisites} prerequisites`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("seed topic failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
