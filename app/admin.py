from django.contrib import admin

from .models import FormConfig, SubmissionLog

admin.site.register(FormConfig)
admin.site.register(SubmissionLog)
