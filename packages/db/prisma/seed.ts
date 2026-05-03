import { getPrisma } from '@ai-hot-news/db';

const prisma = getPrisma();

const candidates: Array<{ name: string; url: string; enabled: boolean }> = [
  { name: 'OpenAI News',          url: 'https://openai.com/news/rss.xml',     enabled: true  },
  { name: 'Anthropic News',       url: 'https://www.anthropic.com/news/rss',  enabled: false },
  { name: 'Google Research Blog', url: 'https://research.google/blog/rss/',   enabled: true  },
  { name: 'Google DeepMind Blog', url: 'https://deepmind.google/blog/rss.xml', enabled: true  },
];

async function main() {
  for (const c of candidates) {
    await prisma.sourceConfig.upsert({
      where: { platform_url: { platform: 'RSS', url: c.url } },
      create: {
        platform: 'RSS',
        name: c.name,
        url: c.url,
        enabled: c.enabled,
        crawlInterval: 1800,
      },
      update: { name: c.name },
    });
    console.log(`seeded: ${c.name} (enabled=${c.enabled})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
