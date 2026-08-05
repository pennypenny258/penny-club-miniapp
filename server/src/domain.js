'use strict';

function isMembershipActive(member, now = new Date()) {
  return evaluateMembership(member, now).active;
}

function evaluateMembership(member, now = new Date()) {
  const reasons = [];
  const followUpReasons = [];
  const inGroup = member?.groupStatus === 'in_group';
  const outsideWindow = !member || !(new Date(member.startsAt) <= now && now < new Date(member.endsAt));
  const renewalHold = Boolean(member && member.status === 'expired' && inGroup && outsideWindow && member.renewalNoticeStatus === 'not_notified');
  if (!member || member.userStatus !== 'active') reasons.push('USER_DISABLED');
  if (!member || (member.status !== 'active' && !renewalHold)) reasons.push('MEMBERSHIP_STATUS_NOT_ACTIVE');
  if (outsideWindow && !renewalHold) reasons.push('OUTSIDE_MEMBERSHIP_WINDOW');
  if (!inGroup) reasons.push('NOT_CURRENTLY_IN_GROUP');
  if (!member || member.crmVerificationStatus !== 'verified') followUpReasons.push('CRM_NEEDS_COMPLETION');
  if (!member || member.latestPaymentEvidenceStatus !== 'verified') followUpReasons.push('PAYMENT_CLUE_NEEDS_REVIEW');
  if (!member || !member.latestValidPaymentAt || new Date(member.latestValidPaymentAt) > now) followUpReasons.push('PAYMENT_TIME_NEEDS_REVIEW');
  if (renewalHold) followUpReasons.push('RENEWAL_FOLLOW_UP_PENDING');
  const active = reasons.length === 0;
  const operationalStatus = active ? (renewalHold ? 'renewal_follow_up_temporarily_active' : followUpReasons.length ? 'active_with_follow_up' : 'active') : 'inactive_or_needs_group_review';
  return { active, reasons, followUpReasons, operationalStatus, renewalHold };
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
