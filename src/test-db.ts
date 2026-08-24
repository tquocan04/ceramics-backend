import db from './core/db';

async function main() {
  try {
    console.log('⏳ Đang kiểm tra kết nối PostgreSQL...');
    await db.$connect();
    console.log('✅ Kết nối PostgreSQL & Prisma Client thành công!');

    const batchCount = await db.productionBatch.count();
    console.log(`📊 Số lượng Batch hiện có: ${batchCount}`);
  } catch (error) {
    console.error('❌ Lỗi kết nối DB:', error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main();