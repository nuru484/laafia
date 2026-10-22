-- CreateTable
CREATE TABLE "content_clips" (
    "id" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "recorded_at" BIGINT NOT NULL,

    CONSTRAINT "content_clips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_clips_prompt" ON "content_clips"("lang", "prompt_id");
