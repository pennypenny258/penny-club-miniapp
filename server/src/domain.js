'use strict';

function isMembershipActive(member, now = new Date()) {
  return evaluateMembership(member, now).active;
}

function evaluateMembership(member, now = new Date()) {
  const reasons = [];
  if (!member || member.userStatus !== 'active') reasons.push('USER_DISABLED');
  if (!member || member.status !== 'active') reasons.push('MEMBERSHIP_STATUS_NOT_ACTIVE');
  if (!member || !(new Date(member.startsAt) <= now && now < new Date(member.endsAt))) reasons.push('OUTSIDE_MEMBERSHIP_WINDOW');
  if (!member || member.crmVerificationStatus !== 'verified') reasons.push('CRM_NOT_VERIFIED');
  if (!member || member.latestPaymentEvidenceStatus !== 'verified') reasons.push('NO_VERIFIED_RECENT_PAYMENT');
  if (!member || !member.latestValidPaymentAt || new Date(member.latestValidPaymentAt) > now) reasons.push('VALID_PAYMENT_TIMESTAMP_MISSING_OR_FUTURE');
  if (!member || member.groupStatus !== 'in_group') reasons.push('NOT_CURRENTLY_IN_GROUP');
  return { active: reasons.length === 0, reasons };
}

function requireActiveMember(member, now) {
  if (!isMembershipActive(member, now)) {
    const error = new Error('仅会籍有效的会员可访问');
    error.statusCode = 403;
    error.code = 'MEMBERSHIP_REQUIRED';
    throw error;
  }
}

function canViewMeetingLink({ member, registration, activity, now = new Date() }) {
  return isMembershipActive(member, now) && registration?.status === 'registered' &&
    new Date(activity.meetingLinkOpensAt) <= now && now <= new Date(activity.meetingLinkClosesAt);
}

function renewalBaseDate(member, paidAt = new Date()) {
  const end = member && new Date(member.endsAt);
  return end && end > paidAt ? end : paidAt;
}

module.exports = { isMembershipActive, evaluateMembership, requireActiveMember, canViewMeetingLink, renewalBaseDate };
