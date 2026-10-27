import assert from "node:assert/strict";
import test from "node:test";
import {
  extractArxivPublicationMetadata,
  normalizePublicationMetadata
} from "../weekly-report/publication-metadata.js";

test("标准 affiliation 节点清除邮箱、编号和通讯作者说明", () => {
  const metadata = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <div class="ltx_authors">
        <span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation:</span> 1 Yale University;</span>
        <span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation:</span> {alice,bob}@yale.edu</span>
        <span class="ltx_contact ltx_role_affiliation"><span class="ltx_contact_name">Affiliation:</span> Huawei Technologies, Shenzhen, China*Corresponding author. E-mail: author@example.com</span>
      </div>
    </article>
  `);

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "Yale University",
    "Huawei Technologies, Shenzhen, China"
  ]);
});

test("同一结构化节点内连续编号的三个单位被分别提取", () => {
  const metadata = extractArxivPublicationMetadata(`
    <article class="ltx_document"><div class="ltx_authors">
      <span class="ltx_contact ltx_role_affiliation">1Universität zu Lübeck 2University College London 3Mohamed bin Zayed University of Artificial Intelligence</span>
    </div></article>
  `);

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "Universität zu Lübeck",
    "University College London",
    "Mohamed bin Zayed University of Artificial Intelligence"
  ]);
});

test("无结构单位块使用上标作为单位分隔符", () => {
  const metadata = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <div class="ltx_authors"><span class="ltx_personname">Chen Qian</span></div>
      <div class="ltx_abstract"><p>Abstract text.</p></div>
      <div class="ltx_logical-block ltx_align_bottom">
        <p><sup>1</sup>William &amp; Mary <sup>2</sup>Anytime AI</p>
        <p>{cqian03,ywang139}@wm.edu {ychen,lwu}@anytime-ai.com</p>
      </div>
      <section><h2>1 Introduction</h2></section>
    </article>
  `);

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "William & Mary",
    "Anytime AI"
  ]);
});

test("正文前底部对齐区块保留院系与大学层级", () => {
  const metadata = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <div class="ltx_authors"><span class="ltx_personname">Yubo Zhang</span></div>
      <div class="ltx_abstract"><p>Abstract text.</p></div>
      <div class="ltx_para ltx_align_bottom">
        <p><sup>1</sup>Department of Electrical &amp; Computer Engineering, University of Washington, Seattle, WA, USA</p>
      </div>
      <section><h2>1 Introduction</h2></section>
    </article>
  `);

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "Department of Electrical & Computer Engineering, University of Washington, Seattle, WA, USA"
  ]);
});

test("异常 LaTeXML 作者宏可以从宏父区块恢复单位", () => {
  const metadata = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <div class="ltx_para">
        <p><span class="ltx_ERROR undefined">\\TRBauthor</span>
          Shuyang LiGraduate Student Civil and Environmental Engineering,
          Rensselaer Polytechnic Institutelis36@rpi.edu
        </p>
      </div>
      <section><h2>1 Introduction</h2></section>
    </article>
  `);

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "Rensselaer Polytechnic Institute"
  ]);
});

test("作者脚注单位去除邮箱与投稿说明但保留机构层级", () => {
  const metadata = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <div class="ltx_authors">
        <span class="ltx_note ltx_note_frontmatter ltx_role_thanks">
          The authors are with the Department of Informatics and Telecommunications,
          National and Kapodistrian University of Athens, Athens, Greece
          (e-mail: author@example.com). A shorter version of this work has been submitted.
        </span>
      </div>
    </article>
  `);

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "Department of Informatics and Telecommunications, National and Kapodistrian University of Athens, Athens, Greece"
  ]);
});

test("结构化单位节点排除带空格的花括号邮箱列表", () => {
  const metadata = extractArxivPublicationMetadata('<article class="ltx_document"><div class="ltx_authors"><span class="ltx_contact ltx_role_affiliation">University of Houston</span><span class="ltx_contact ltx_role_affiliation">{cshen9, jni7}@uh.edu</span><span class="ltx_contact ltx_role_affiliation">NEC Labs</span><span class="ltx_contact ltx_role_affiliation">{wyu, weicheng, haifeng}@nec-labs.com</span></div></article>');

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "University of Houston",
    "NEC Labs"
  ]);
});

test("独立研究者单位清除尾部 Email 标签", () => {
  const metadata = extractArxivPublicationMetadata('<article class="ltx_document"><div class="ltx_authors"><span class="ltx_contact ltx_role_affiliation">Independent Researcher Email: author@example.com</span></div></article>');

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "Independent Researcher"
  ]);
});

test("作者脚注清除姓名与 is with 前缀", () => {
  const metadata = extractArxivPublicationMetadata('<article class="ltx_document"><div class="ltx_authors"><span class="ltx_note ltx_note_frontmatter ltx_role_thanks">Hyeonho Noh is with the Department of Information and Communication Engineering, Hanbat National University, Republic of Korea</span></div></article>');

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "Department of Information and Communication Engineering, Hanbat National University, Republic of Korea"
  ]);
});

test("多人作者脚注只保留 are with 后的单位并拆分 also with 单位", () => {
  const metadata = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <div class="ltx_authors">
        <span class="ltx_note ltx_note_frontmatter ltx_role_thanks">
          Yuyao Wang, Gaoze Mu, and Yongan Zheng are with the National Engineering Research Center,
          Beijing University of Posts and Telecommunications, Beijing, China, and also with the
          Department of Broadband Communication, Peng Cheng Laboratory, Shenzhen, China
          (e-mails: yuyao@example.edu, gaoze@example.edu).
        </span>
      </div>
    </article>
  `);

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "National Engineering Research Center, Beijing University of Posts and Telecommunications, Beijing, China",
    "Department of Broadband Communication, Peng Cheng Laboratory, Shenzhen, China"
  ]);
});

test("单作者脚注将 is with 和 also with 的两个单位分别保留", () => {
  const metadata = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <div class="ltx_authors">
        <span class="ltx_note ltx_note_frontmatter ltx_role_thanks">
          Li Yang is with the Faculty of Business and Information Technology, Ontario Tech University,
          Oshawa, Canada, and also with the Department of Electrical and Computer Engineering,
          Western University, London, Canada (e-mails: li.yang@example.edu).
        </span>
      </div>
    </article>
  `);

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "Faculty of Business and Information Technology, Ontario Tech University, Oshawa, Canada",
    "Department of Electrical and Computer Engineering, Western University, London, Canada"
  ]);
});

test("只包含多位作者姓名的结构化 affiliation 节点不会成为单位", () => {
  const metadata = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <div class="ltx_authors">
        <span class="ltx_contact ltx_role_affiliation">Qian Chen, Kin K. Leung, Xianhao Chen</span>
      </div>
    </article>
  `);

  assert.equal(metadata.status, "not_provided");
  assert.deepEqual(metadata.affiliations, []);
});


test("结构化 affiliation 节点与标题页单个作者完全相同时不会成为单位", () => {
  const metadata = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <div class="ltx_authors">
        <span class="ltx_personname">alice de souza</span>
        <span class="ltx_contact ltx_role_affiliation">alice de souza</span>
      </div>
    </article>
  `);

  assert.equal(metadata.status, "not_provided");
  assert.deepEqual(metadata.affiliations, []);
});
test("结构化单位清除尾部通讯作者复数说明", () => {
  const metadata = extractArxivPublicationMetadata('<article class="ltx_document"><div class="ltx_authors"><span class="ltx_contact ltx_role_affiliation">Korea Institute of Science and Technology (KIST), Republic of Korea † Corresponding authors</span></div></article>');

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "Korea Institute of Science and Technology (KIST), Republic of Korea"
  ]);
});

test("独立共同通讯作者说明不会成为单位", () => {
  const metadata = extractArxivPublicationMetadata('<article class="ltx_document"><div class="ltx_authors"><span class="ltx_contact ltx_role_affiliation">Vanderbilt University</span><span class="ltx_contact ltx_role_affiliation">Co-last and co-corresponding authors. Correspondence: Thomas A. Cassini (author@example.com) and Cathy Shyr</span></div></article>');

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "Vanderbilt University"
  ]);
});

test("已知缺失分隔符的 TUM 单位可读拆分且不改写普通驼峰名称", () => {
  const metadata = extractArxivPublicationMetadata('<article class="ltx_document"><div class="ltx_authors"><span class="ltx_contact ltx_role_affiliation">Professorship of Autonomous Vehicle Systems, TUM School of Engineering and DesignTechnical University of Munich, 85748 Garching, Germany;Munich Institute of Robotics and Machine Intelligence (MIRMI</span><span class="ltx_contact ltx_role_affiliation">SomeCamelCase Labs</span></div></article>');

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "Professorship of Autonomous Vehicle Systems, TUM School of Engineering and Design",
    "Technical University of Munich, 85748 Garching, Germany",
    "Munich Institute of Robotics and Machine Intelligence (MIRMI)",
    "SomeCamelCase Labs"
  ]);
});

test("正文、致谢和参考文献 section 内的结构化单位节点全部忽略", () => {
  const metadata = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <section><h2>1 Introduction</h2><span class="ltx_contact ltx_role_affiliation">Body University</span></section>
      <section><h2>Acknowledgements</h2><span class="ltx_contact ltx_role_affiliation">Acknowledgement Institute</span></section>
      <section class="ltx_bibliography"><span class="ltx_contact ltx_role_affiliation">Reference Laboratory</span></section>
    </article>
  `);

  assert.equal(metadata.status, "not_provided");
  assert.deepEqual(metadata.affiliations, []);
});

test("第一节正文后的结构化单位和 footer 节点全部忽略", () => {
  const structured = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <section><h2>1 Introduction</h2><p>Body text.</p></section>
      <span class="ltx_contact ltx_role_affiliation">Late University</span>
    </article>
  `);
  const footer = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <section><h2>1 Introduction</h2><p>Body text.</p></section>
      <div class="ltx_para ltx_align_bottom"><p>Footer Institute</p></div>
    </article>
  `);


  assert.equal(structured.status, "not_provided");
  assert.deepEqual(structured.affiliations, []);
  assert.equal(footer.status, "not_provided");
  assert.deepEqual(footer.affiliations, []);
});

test("正文后的 logical block 即使同时含机构和邮箱也不会成为单位", () => {
  const metadata = extractArxivPublicationMetadata(`
    <article class="ltx_document">
      <section><h2>1 Introduction</h2><p>Body text.</p></section>
      <div class="ltx_logical-block">
        <p>Post-body University</p>
        <p>contact@example.edu</p>
      </div>
    </article>
  `);

  assert.equal(metadata.status, "not_provided");
  assert.deepEqual(metadata.affiliations, []);
});

test("读取旧缓存时重新清洗受污染单位且不删除有效缓存", () => {
  const metadata = normalizePublicationMetadata({
    status: "extracted",
    affiliations: [
      {
        originalName: "Yuyao Wang, Gaoze Mu, and Yongan Zheng are with the National Engineering Research Center, Beijing University of Posts and Telecommunications, and also with Department of Broadband Communication, Peng Cheng Laboratory (e-mails: test@example.edu).",
        sourceText: "original trace text",
        sourceType: "cached",
        confidence: "medium"
      },
      {
        originalName: "Qian Chen, Kin K. Leung, Xianhao Chen",
        sourceText: "Qian Chen, Kin K. Leung, Xianhao Chen",
        sourceType: "cached",
        confidence: "medium"
      },
      {
        originalName: "Coinbase, Inc.",
        sourceText: "Coinbase, Inc.",
        sourceType: "cached",
        confidence: "high"
      }
    ]
  });

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "National Engineering Research Center, Beijing University of Posts and Telecommunications",
    "Department of Broadband Communication, Peng Cheng Laboratory",
    "Coinbase, Inc"
  ]);
});

test("旧缓存清洗后没有有效单位时状态回落为 not_provided", () => {
  const metadata = normalizePublicationMetadata({
    status: "extracted",
    affiliations: [{
      originalName: "Qian Chen, Kin K. Leung, Xianhao Chen",
      sourceType: "arxiv_structured"
    }]
  });

  assert.equal(metadata.status, "not_provided");
  assert.deepEqual(metadata.affiliations, []);
});

test("旧缓存中被截断的邮箱标签不会保留在单位原名中", () => {
  const metadata = normalizePublicationMetadata({
    status: "extracted",
    affiliations: [{
      originalName: "Department of Electrical and Computer Engineering, Western University, London, ON N6A 3K7, Canada (e-mails",
      sourceText: "Li Yang is with Western University (e-mails: li.yang@example.edu).",
      sourceType: "arxiv_frontmatter_note",
      confidence: "medium"
    }]
  });

  assert.deepEqual(metadata.affiliations.map((item) => item.originalName), [
    "Department of Electrical and Computer Engineering, Western University, London, ON N6A 3K7, Canada"
  ]);
});
