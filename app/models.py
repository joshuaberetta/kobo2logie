from django.db import models


class FormConfig(models.Model):
    uid = models.CharField(max_length=64, unique=True, db_index=True)
    config = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.uid


class SubmissionLog(models.Model):
    form_uid = models.CharField(max_length=64, db_index=True)
    ts = models.BigIntegerField()       # Unix ms timestamp
    uuid = models.CharField(max_length=64, blank=True, default='')
    submission_id = models.IntegerField(null=True, blank=True)
    data = models.JSONField(default=dict)   # full LogEntry fields (ok, httpStatus, steps, etc.)

    class Meta:
        ordering = ['-ts']
        indexes = [models.Index(fields=['form_uid', '-ts'])]

    def __str__(self):
        return f'{self.form_uid} / {self.uuid} @ {self.ts}'
