# Ren's code bundles for brains and hands (packages/cell/machine/bundle.ts). The deploy uploads them to
# bundles/ in the artifacts bucket and moves bundles/current.json; the server reads current.json and
# signs the links that machines download the archives from.
resource "aws_iam_role_policy" "server_task_bundles" {
  name = "bundles"
  role = aws_iam_role.server_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "s3:GetObject", Resource = "${aws_s3_bucket.artifacts.arn}/bundles/*" },
    ]
  })
}
