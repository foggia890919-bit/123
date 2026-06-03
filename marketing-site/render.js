/*
 * 공용 렌더러 — 콘텐츠(JSON) → HTML 문자열.
 * Node(서버 SSR)와 브라우저(관리자 실시간 미리보기) 양쪽에서 동일하게 사용한다.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.SiteRender = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  // 줄바꿈을 <br>로, 그 외는 escape
  function multiline(s) {
    return esc(s).replace(/\n/g, "<br>");
  }
  // 문단 단위(\n) 분리
  function paragraphs(s) {
    return String(s || "")
      .split(/\n{1,}/)
      .filter(function (p) { return p.trim() !== ""; })
      .map(function (p) { return "<p>" + multiline(p) + "</p>"; })
      .join("");
  }
  function bg(image) {
    return image ? ' style="background-image:linear-gradient(rgba(8,28,54,.62),rgba(8,28,54,.62)),url(' + esc(image) + ')"' : "";
  }

  var renderers = {
    hero: function (d) {
      var actions = "";
      if (d.ctaText) actions += '<a class="btn btn-primary" href="' + esc(d.ctaLink || "#") + '">' + esc(d.ctaText) + "</a>";
      if (d.secondaryText) actions += '<a class="btn btn-ghost" href="' + esc(d.secondaryLink || "#") + '">' + esc(d.secondaryText) + "</a>";
      return (
        '<section class="hero' + (d.bgImage ? " hero--image" : "") + '"' + bg(d.bgImage) + ">" +
        '<div class="container hero__inner">' +
        (d.eyebrow ? '<p class="eyebrow">' + esc(d.eyebrow) + "</p>" : "") +
        '<h1 class="hero__title">' + multiline(d.title) + "</h1>" +
        (d.subtitle ? '<p class="hero__subtitle">' + multiline(d.subtitle) + "</p>" : "") +
        (actions ? '<div class="hero__actions">' + actions + "</div>" : "") +
        "</div></section>"
      );
    },

    stats: function (d) {
      var items = (d.items || []).map(function (it) {
        return '<div class="stat"><div class="stat__value">' + esc(it.value) + '</div><div class="stat__label">' + esc(it.label) + "</div></div>";
      }).join("");
      return (
        '<section class="section stats"><div class="container">' +
        (d.heading ? '<h2 class="section__title">' + esc(d.heading) + "</h2>" : "") +
        '<div class="stats__grid">' + items + "</div>" +
        "</div></section>"
      );
    },

    about: function (d) {
      return (
        '<section class="section about" id="about"><div class="container about__grid">' +
        '<div class="about__text">' +
        (d.heading ? '<h2 class="section__title">' + esc(d.heading) + "</h2>" : "") +
        (d.lead ? '<p class="lead">' + multiline(d.lead) + "</p>" : "") +
        paragraphs(d.body) +
        "</div>" +
        (d.image ? '<div class="about__media"><img src="' + esc(d.image) + '" alt=""></div>' : "") +
        "</div></section>"
      );
    },

    features: function (d) {
      var items = (d.items || []).map(function (it) {
        return (
          '<div class="card">' +
          '<div class="card__icon">' + esc(it.icon) + "</div>" +
          '<h3 class="card__title">' + esc(it.title) + "</h3>" +
          '<p class="card__desc">' + multiline(it.desc) + "</p>" +
          "</div>"
        );
      }).join("");
      return (
        '<section class="section features"><div class="container">' +
        '<div class="section__head">' +
        (d.heading ? '<h2 class="section__title">' + esc(d.heading) + "</h2>" : "") +
        (d.subheading ? '<p class="section__sub">' + esc(d.subheading) + "</p>" : "") +
        "</div>" +
        '<div class="cards">' + items + "</div>" +
        "</div></section>"
      );
    },

    steps: function (d) {
      var items = (d.items || []).map(function (it) {
        return (
          '<div class="step">' +
          '<div class="step__num">' + esc(it.step) + "</div>" +
          '<div class="step__body"><h3>' + esc(it.title) + "</h3><p>" + multiline(it.desc) + "</p></div>" +
          "</div>"
        );
      }).join("");
      return (
        '<section class="section steps"><div class="container">' +
        '<div class="section__head">' +
        (d.heading ? '<h2 class="section__title">' + esc(d.heading) + "</h2>" : "") +
        (d.subheading ? '<p class="section__sub">' + esc(d.subheading) + "</p>" : "") +
        "</div>" +
        '<div class="steps__list">' + items + "</div>" +
        "</div></section>"
      );
    },

    history: function (d) {
      var items = (d.items || []).map(function (it) {
        return '<li class="tl__item"><span class="tl__year">' + esc(it.year) + '</span><span class="tl__text">' + multiline(it.text) + "</span></li>";
      }).join("");
      return (
        '<section class="section history"><div class="container">' +
        (d.heading ? '<h2 class="section__title">' + esc(d.heading) + "</h2>" : "") +
        '<ul class="timeline">' + items + "</ul>" +
        "</div></section>"
      );
    },

    gallery: function (d) {
      var imgs = (d.images || []).map(function (u) {
        return '<div class="gallery__item"><img src="' + esc(u) + '" alt=""></div>';
      }).join("");
      return (
        '<section class="section gallery"><div class="container">' +
        (d.heading ? '<h2 class="section__title">' + esc(d.heading) + "</h2>" : "") +
        '<div class="gallery__grid">' + imgs + "</div>" +
        "</div></section>"
      );
    },

    richtext: function (d) {
      return (
        '<section class="section richtext"><div class="container narrow">' +
        (d.heading ? '<h2 class="section__title">' + esc(d.heading) + "</h2>" : "") +
        paragraphs(d.body) +
        "</div></section>"
      );
    },

    cta: function (d) {
      return (
        '<section class="cta' + (d.bgImage ? " cta--image" : "") + '"' + bg(d.bgImage) + '><div class="container cta__inner">' +
        '<h2 class="cta__title">' + multiline(d.title) + "</h2>" +
        (d.subtitle ? '<p class="cta__sub">' + multiline(d.subtitle) + "</p>" : "") +
        (d.buttonText ? '<a class="btn btn-primary btn-lg" href="' + esc(d.buttonLink || "#") + '">' + esc(d.buttonText) + "</a>" : "") +
        "</div></section>"
      );
    },

    contact: function (d) {
      var rows = [
        ["회사명", d.company],
        ["대표", d.ceo],
        ["사업자등록번호", d.bizNo],
        ["주소", d.address],
        ["전화", d.phone],
        ["이메일", d.email],
        ["운영시간", d.hours]
      ].filter(function (r) { return r[1]; }).map(function (r) {
        return '<div class="info__row"><dt>' + esc(r[0]) + "</dt><dd>" + multiline(r[1]) + "</dd></div>";
      }).join("");
      return (
        '<section class="section contact" id="contact"><div class="container contact__grid">' +
        '<div class="contact__info">' +
        (d.heading ? '<h2 class="section__title">' + esc(d.heading) + "</h2>" : "") +
        '<dl class="info">' + rows + "</dl>" +
        (d.phone ? '<a class="btn btn-primary" href="tel:' + esc(d.phone) + '">전화 상담 ' + esc(d.phone) + "</a>" : "") +
        "</div>" +
        (d.mapEmbed ? '<div class="contact__map">' + d.mapEmbed + "</div>" : "") +
        "</div></section>"
      );
    }
  };

  function renderSection(section) {
    if (!section || section.visible === false) return "";
    var fn = renderers[section.type];
    if (!fn) return "";
    try { return fn(section.data || {}); }
    catch (e) { return "<!-- render error: " + esc(String(e)) + " -->"; }
  }

  function renderSections(content) {
    return (content.sections || []).map(renderSection).join("\n");
  }

  return {
    esc: esc,
    types: Object.keys(renderers),
    renderSection: renderSection,
    renderSections: renderSections
  };
});
